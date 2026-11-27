/**
 * POST /decks/:id/import, implementing docs/DUPLICATES.md section 10.3:
 *   1. in-file duplicates (shared with the client preview)
 *   2. alias lookup on entry_aliases by input_side (hit only if exactly one entry matches)
 *   3. candidates: live cards by term_key, or by lemma_key of the alias hits, plus glosses
 *   4. per row: term-key match ?? findDuplicate(entry) -> mergeTranslation + 'in_deck';
 *      otherwise plan an insert ('ready' for alias hits, else 'pending')
 *   5. one db.batch: merges, ONE INSERT OR IGNORE ... SELECT FROM json_each(?) RETURNING id for
 *      every row, ONE gloss insert; rows that lose a race are reported as 'in_deck' duplicates.
 * D1 has no interactive transactions, so every race guard lives in a single statement
 * (section 10.5). The statement count is bounded (about 8 for any import; see DECISIONS.md M4).
 */
import type { LanguageCode } from '../../shared/languages'
import {
  compatLang,
  keyRows,
  parseImport,
  splitInFileDuplicates,
  type InFileDuplicate,
  type KeyedRow,
  type LanguagePair,
} from '../../shared/parseImport'
import type { DuplicateReport, ImportInput, ImportResponse } from '../../shared/schemas'
import { lemmaDisplay } from '../db/cards'
import { deckSettings, type DeckRow } from '../db/decks'
import {
  entryGlosses,
  findDuplicate,
  glossInsertStatement,
  loadCandidates,
  lookupAliases,
  mergeStatements,
  planMerge,
  sourceWord,
  type Candidate,
  type EntryRow,
  type Merge,
  type Side,
} from './resolve'

type Planned = {
  row: KeyedRow
  entry: EntryRow | null
  side: Side | null
  candidate: Candidate
}

/** A duplicate whose `existing` card is resolved once the inserts have run. */
type PendingReport = Omit<DuplicateReport, 'existing'> & { target: Candidate }

export class TooManyRowsError extends Error {}

export async function importCards(db: D1Database, deck: DeckRow, body: ImportInput): Promise<ImportResponse> {
  const parsed = parseImport(body.text, { filename: body.filename })
  if (parsed.tooMany) throw new TooManyRowsError()
  // 1. In-file duplicates.
  const { unique, duplicates: inFile } = splitInFileDuplicates(keyRows(parsed.rows, deckPair(deck), body.inputLang))
  return { ...(await insertRows(db, deck, unique, inFile, 'import')), invalid: parsed.invalid }
}

export function deckPair(deck: DeckRow): LanguagePair {
  return { sourceLang: deck.source_lang as LanguageCode, targetLang: deck.target_lang as LanguageCode }
}

export type InsertResult = Omit<ImportResponse, 'invalid'>

/**
 * Steps 2-5 of section 10.3 for keyed rows without in-file duplicates. Shared by /import and
 * /suggest (DUPLICATES.md 10.7: suggested words take the same insert path, so a word already in
 * the shared cache is ready at once). Reports of 'suggested' rows carry no line numbers.
 */
export async function insertRows(
  db: D1Database,
  deck: DeckRow,
  unique: KeyedRow[],
  inFile: readonly InFileDuplicate[],
  origin: 'import' | 'suggested',
): Promise<InsertResult> {
  const pair = deckPair(deck)
  const src = pair.sourceLang

  // 2. Alias lookup (one query).
  const hits = await lookupAliases(db, pair, unique)

  // 3. Candidates (one query): live cards with a matching term_key or the lemma_key of an alias hit.
  const candidates = await loadCandidates(
    db,
    deck.id,
    src,
    unique.map((r) => r.termKey),
    [...hits.values()].map((h) => h.entry.lemma_key),
  )

  // 4. Decide per row.
  const now = Date.now()
  const merges: Merge[] = []
  const reports: PendingReport[] = []
  const resolvedBy = new Map<KeyedRow, Candidate>()
  const planned: Planned[] = []

  for (const r of unique) {
    const hit = hits.get(r) ?? null
    const side: Side | null = hit?.side ?? (r.lang === 'auto' ? null : r.lang)
    const glossesN = hit ? entryGlosses(src, hit.entry, r.hintKey) : new Set<string>()

    const existing =
      candidates.find(
        (c) => !c.planned && compatLang(c.inputLang, r.lang) && c.termKey === r.termKey && (r.hintKey === '' || c.hintKey === r.hintKey),
      ) ?? (hit ? findDuplicate(candidates, src, hit.entry, r.hintKey, glossesN) : undefined)

    if (existing) {
      resolvedBy.set(r, existing)
      const merge = planMerge(src, existing, sourceWord(side, r.term, r.hint))
      // A planned card carries its extras in its INSERT; only existing cards need an UPDATE.
      if (merge && !existing.planned) merges.push(merge)
      reports.push({
        input: r.term,
        ...(r.hint ? { hint: r.hint } : {}),
        line: r.line,
        reason: existing.planned ? 'in_file' : 'in_deck',
        target: existing,
        addedTranslation: merge?.word ?? null,
      })
      continue
    }

    const candidate: Candidate = {
      id: crypto.randomUUID(),
      inputLang: r.lang,
      termKey: r.termKey,
      hintKey: r.hintKey,
      lemmaKey: hit?.entry.lemma_key ?? null,
      senseKey: hit ? r.hintKey : null,
      status: hit ? 'ready' : 'pending',
      display: hit ? lemmaDisplay(hit.entry.lemma, hit.entry.grammar_json) : r.term,
      glosses: glossesN,
      extras: [],
      planned: true,
    }
    const p: Planned = { row: r, entry: hit?.entry ?? null, side: hit?.side ?? null, candidate }
    candidates.push(candidate)
    planned.push(p)
    resolvedBy.set(r, candidate)
  }

  // 5. One batch: translation merges (2), ONE INSERT OR IGNORE ... RETURNING for all rows, glosses (1).
  const mergeStmts = mergeStatements(db, merges, now)
  const statements: D1PreparedStatement[] = [...mergeStmts]
  const insertIndex = statements.length
  // Imported words skip Learn when the deck says so (suggested words are new vocabulary: always Learn).
  const skipLearn = origin === 'import' && deckSettings(deck).importToTrain
  if (planned.length > 0) statements.push(insertStatement(db, deck.id, now, planned, origin, skipLearn))
  const glossPairs = planned.flatMap((p) => (p.entry ? [...p.candidate.glosses].map((g): [string, string] => [p.candidate.id, g]) : []))
  if (glossPairs.length > 0) statements.push(glossInsertStatement(db, glossPairs))
  const results = statements.length > 0 ? await db.batch<{ id: string }>(statements) : []
  const inserted = new Set(planned.length > 0 ? results[insertIndex]!.results.map((x) => x.id) : [])

  // Rows that lost an INSERT OR IGNORE race: point them (and anything resolved to them) at the winner.
  const lost = planned.filter((p) => !inserted.has(p.candidate.id))
  if (lost.length > 0) {
    const winners = await loadCandidates(
      db,
      deck.id,
      src,
      lost.map((p) => p.row.termKey),
      lost.flatMap((p) => (p.candidate.lemmaKey ? [p.candidate.lemmaKey] : [])),
    )
    for (const p of lost) {
      const c = p.candidate
      const winner =
        winners.find((w) => w.inputLang === c.inputLang && w.termKey === c.termKey && w.hintKey === c.hintKey) ??
        winners.find((w) => c.lemmaKey !== null && w.lemmaKey === c.lemmaKey && w.senseKey === c.senseKey)
      if (winner) c.winner = winner
      reports.push({
        input: p.row.term,
        ...(p.row.hint ? { hint: p.row.hint } : {}),
        line: p.row.line,
        reason: 'in_deck',
        target: c,
        addedTranslation: null,
      })
    }
  }

  // In-file duplicates point at whatever card their first occurrence ended up as.
  for (const d of inFile) {
    const target = resolvedBy.get(d.first)
    if (!target) continue
    reports.push({
      input: d.row.term,
      ...(d.row.hint ? { hint: d.row.hint } : {}),
      line: d.row.line,
      reason: 'in_file',
      target,
      addedTranslation: null,
    })
  }

  const duplicates: DuplicateReport[] = []
  for (const { target, ...rest } of reports) {
    let card = target
    while (card.winner) card = card.winner
    // A lost insert with no winner found (the winner was deleted meanwhile) has nothing to point to.
    if (card.planned && !inserted.has(card.id)) continue
    duplicates.push({ ...rest, existing: { id: card.id, display: card.display, status: card.status } })
  }
  duplicates.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))

  const insertedPlanned = planned.filter((p) => inserted.has(p.candidate.id))
  const ready = insertedPlanned.filter((p) => p.entry).length
  return {
    added: insertedPlanned.length,
    ready,
    pending: insertedPlanned.length - ready,
    duplicates: origin === 'import' ? duplicates : duplicates.map(({ line: _line, ...d }) => d),
  }
}

const INSERT_COLUMNS =
  'id, deck_id, entry_id, input_term, input_hint, term_key, input_lang, input_side, hint_key, lemma_key, sense_key, status, extra_translations_json, origin, due, created_at, updated_at, skip_learn'

/**
 * ONE statement for every row: INSERT OR IGNORE ... SELECT ... FROM json_each(?) RETURNING id.
 * Rows are inserted in array (= file) order; a row that conflicts with a live card (or an
 * earlier row of the same statement) is skipped and simply not returned.
 */
function insertStatement(
  db: D1Database,
  deckId: string,
  now: number,
  rows: readonly Planned[],
  origin: 'import' | 'suggested',
  skipLearn: boolean,
): D1PreparedStatement {
  const data = rows.map((p) => {
    const c = p.candidate
    return [c.id, p.entry?.id ?? null, p.row.term, p.row.hint ?? null, c.termKey, c.inputLang, p.side, c.hintKey, c.lemmaKey, c.senseKey, c.status, JSON.stringify(c.extras)]
  })
  const col = (i: number) => `json_extract(j.value, '$[${i}]')`
  const values = [col(0), '?2', ...Array.from({ length: 11 }, (_, i) => col(i + 1)), '?4', '?3', '?3', '?3', '?5']
  return db
    .prepare(
      `INSERT OR IGNORE INTO cards (${INSERT_COLUMNS})
       SELECT ${values.join(', ')} FROM json_each(?1) j ORDER BY j.key
       RETURNING id`,
    )
    .bind(JSON.stringify(data), deckId, now, origin, skipLearn ? 1 : 0)
}
