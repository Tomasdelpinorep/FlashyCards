/**
 * POST /decks/:id/import, implementing docs/DUPLICATES.md section 10.3:
 *   1. in-file duplicates (shared with the client preview)
 *   2. alias lookup on entry_aliases by input_side (hit only if exactly one entry matches)
 *   3. candidates: live cards by term_key, or by lemma_key of the alias hits, plus glosses
 *   4. per row: term-key match ?? findDuplicate(entry) -> mergeTranslation + 'in_deck';
 *      otherwise plan an insert ('ready' for alias hits, else 'pending')
 *   5. INSERT OR IGNORE ... RETURNING (<= 7 rows per statement), all in one db.batch;
 *      rows that lose a race are reported as 'in_deck' duplicates of the winner.
 * D1 has no interactive transactions, so every race guard lives in a single statement
 * (section 10.5).
 */
import type { LanguageCode } from '../../shared/languages'
import { glossKey, termKey } from '../../shared/normalize'
import {
  compatLang,
  keyRows,
  parseImport,
  splitInFileDuplicates,
  type InputLang,
  type KeyedRow,
  type LanguagePair,
} from '../../shared/parseImport'
import type { CardStatus, DuplicateReport, ImportInput, ImportResponse } from '../../shared/schemas'
import { cardDisplay, lemmaDisplay } from '../db/cards'
import type { DeckRow } from '../db/decks'
import { chunk, parseJsonArray, selectIn } from '../db/util'

/** At most 7 rows per multi-row INSERT (12 bound values per row + 2 shared, under D1's 100). */
export const INSERT_ROWS_PER_STATEMENT = 7
export const MAX_EXTRA_TRANSLATIONS = 10

type Side = 'target' | 'source'

type EntryRow = {
  id: string
  lemma: string
  lemma_key: string
  translation: string | null
  alt_translations_json: string | null
  grammar_json: string | null
}

type CandidateRow = {
  id: string
  input_term: string
  input_lang: InputLang
  input_side: Side | null
  term_key: string
  hint_key: string
  lemma_key: string | null
  sense_key: string | null
  status: CardStatus
  extra_translations_json: string
  created_at: number
  seq: number
  e_lemma: string | null
  e_grammar: string | null
}

/** A live card in the deck, or a card this import is about to insert (`planned`). */
type Candidate = {
  id: string
  inputLang: InputLang
  termKey: string
  hintKey: string
  lemmaKey: string | null
  senseKey: string | null
  status: CardStatus
  display: string
  glosses: Set<string>
  extras: string[]
  planned: Planned | null
  /** Set when a planned insert lost a race: the card that won. */
  winner?: Candidate
}

type Planned = {
  row: KeyedRow
  entry: EntryRow | null
  side: Side | null
  candidate: Candidate
}

type Hit = { entry: EntryRow; side: Side }

/** A duplicate whose `existing` card is resolved once the inserts have run. */
type PendingReport = Omit<DuplicateReport, 'existing'> & { target: Candidate }

export class TooManyRowsError extends Error {}

export async function importCards(db: D1Database, deck: DeckRow, body: ImportInput): Promise<ImportResponse> {
  const pair: LanguagePair = {
    sourceLang: deck.source_lang as LanguageCode,
    targetLang: deck.target_lang as LanguageCode,
  }
  const src = pair.sourceLang
  const parsed = parseImport(body.text, { filename: body.filename })
  if (parsed.tooMany) throw new TooManyRowsError()

  // 1. In-file duplicates.
  const { unique, duplicates: inFile } = splitInFileDuplicates(keyRows(parsed.rows, pair, body.inputLang))

  // 2. Alias lookup.
  const hits = await lookupAliases(db, pair, unique)

  // 3. Candidates: live cards with a matching term_key or the lemma_key of an alias hit.
  const candidates = await loadCandidates(
    db,
    deck.id,
    src,
    unique.map((r) => r.termKey),
    [...hits.values()].map((h) => h.entry.lemma_key),
  )

  // 4. Decide per row.
  const now = Date.now()
  const merges: D1PreparedStatement[] = []
  const reports: PendingReport[] = []
  const resolvedBy = new Map<KeyedRow, Candidate>()
  const planned: Planned[] = []

  const mergeTranslation = (e: Candidate, r: KeyedRow, side: Side | null): string | null => {
    const w = side === 'source' ? r.term : side === 'target' ? (r.hint ?? null) : null
    if (!w) return null
    const g = glossKey(src, w)
    if (!g || e.glosses.has(g) || e.extras.length >= MAX_EXTRA_TRANSLATIONS) return null
    e.glosses.add(g)
    e.extras.push(w)
    if (!e.planned) {
      merges.push(
        db
          .prepare(
            `UPDATE cards SET extra_translations_json = json_insert(extra_translations_json, '$[#]', ?), updated_at = ?
             WHERE id = ? AND json_array_length(extra_translations_json) < ${MAX_EXTRA_TRANSLATIONS}
               AND NOT EXISTS (SELECT 1 FROM json_each(extra_translations_json) WHERE value = ?)`,
          )
          .bind(w, now, e.id, w),
        db
          .prepare('INSERT OR IGNORE INTO card_glosses (deck_id, gloss_key, card_id) SELECT deck_id, ?, id FROM cards WHERE id = ?')
          .bind(g, e.id),
      )
    }
    return w
  }

  for (const r of unique) {
    const hit = hits.get(r) ?? null
    const side: Side | null = hit?.side ?? (r.lang === 'auto' ? null : r.lang)
    const glossesN = hit ? entryGlosses(src, hit.entry, r.hintKey) : new Set<string>()
    const translationKey = hit?.entry.translation ? glossKey(src, hit.entry.translation) : ''

    const existing =
      candidates.find(
        (c) => !c.planned && compatLang(c.inputLang, r.lang) && c.termKey === r.termKey && (r.hintKey === '' || c.hintKey === r.hintKey),
      ) ?? (hit ? findDuplicate(candidates, hit.entry.lemma_key, r.hintKey, translationKey, glossesN) : undefined)

    if (existing) {
      resolvedBy.set(r, existing)
      reports.push({
        input: r.term,
        ...(r.hint ? { hint: r.hint } : {}),
        line: r.line,
        reason: existing.planned ? 'in_file' : 'in_deck',
        target: existing,
        addedTranslation: mergeTranslation(existing, r, side),
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
      planned: null,
    }
    const p: Planned = { row: r, entry: hit?.entry ?? null, side: hit?.side ?? null, candidate }
    candidate.planned = p
    candidates.push(candidate)
    planned.push(p)
    resolvedBy.set(r, candidate)
  }

  // 5. One batch: translation merges, chunked INSERT OR IGNORE ... RETURNING, then glosses.
  const insertChunks = chunk(planned, INSERT_ROWS_PER_STATEMENT)
  const statements: D1PreparedStatement[] = [...merges, ...insertChunks.map((part) => insertStatement(db, deck.id, now, part))]
  const glossPairs = planned.flatMap((p) => (p.entry ? [...p.candidate.glosses].map((g) => [p.candidate.id, g]) : []))
  if (glossPairs.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO card_glosses (deck_id, gloss_key, card_id)
           SELECT c.deck_id, json_extract(j.value, '$[1]'), c.id
           FROM json_each(?) j JOIN cards c ON c.id = json_extract(j.value, '$[0]')`,
        )
        .bind(JSON.stringify(glossPairs)),
    )
  }
  const results = statements.length > 0 ? await db.batch<{ id: string }>(statements) : []
  const inserted = new Set(
    results.slice(merges.length, merges.length + insertChunks.length).flatMap((res) => res.results.map((x) => x.id)),
  )

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
    invalid: parsed.invalid,
    duplicates,
  }
}

function entryGlosses(src: LanguageCode, entry: EntryRow, hintKey: string): Set<string> {
  const words = [entry.translation ?? '', ...parseJsonArray(entry.alt_translations_json)]
  const out = new Set(words.map((w) => glossKey(src, w)).filter(Boolean))
  if (hintKey) out.add(hintKey)
  return out
}

/**
 * DUPLICATES.md 10.1: the earliest live resolved card E with the same lemma_key such that
 * N has no hint, or N's sense equals E's, or N's hint/translation is one of E's glosses,
 * or E's hint is one of N's glosses.
 */
function findDuplicate(
  candidates: readonly Candidate[],
  lemmaKey: string,
  hintKey: string,
  translationKey: string,
  glossesN: ReadonlySet<string>,
): Candidate | undefined {
  return candidates.find(
    (e) =>
      e.lemmaKey === lemmaKey &&
      (hintKey === '' ||
        e.senseKey === hintKey ||
        e.glosses.has(hintKey) ||
        (translationKey !== '' && e.glosses.has(translationKey)) ||
        (e.hintKey !== '' && glossesN.has(e.hintKey))),
  )
}

async function lookupAliases(db: D1Database, pair: LanguagePair, rows: readonly KeyedRow[]): Promise<Map<KeyedRow, Hit>> {
  const sidesOf = (r: KeyedRow): [Side, string][] => {
    const sides: Side[] = r.lang === 'auto' ? ['target', 'source'] : [r.lang]
    return sides.map((side) => [side, r.lang === 'auto' ? termKey(side === 'target' ? pair.targetLang : pair.sourceLang, r.term) : r.termKey])
  }
  const keys = rows.flatMap((r) => sidesOf(r).map(([, k]) => k))
  const aliases = await selectIn<{ input_side: Side; alias_key: string; sense_key: string; entry_id: string }>(
    db,
    keys,
    (inList) =>
      `SELECT input_side, alias_key, sense_key, entry_id FROM entry_aliases
       WHERE source_lang = ? AND target_lang = ? AND alias_key IN (${inList})`,
    [pair.sourceLang, pair.targetLang],
  )
  const index = new Map<string, Set<string>>()
  for (const a of aliases) {
    const k = `${a.input_side}\u0000${a.alias_key}\u0000${a.sense_key}`
    index.set(k, (index.get(k) ?? new Set()).add(a.entry_id))
  }

  const rowHits = new Map<KeyedRow, { entryId: string; side: Side }>()
  for (const r of rows) {
    const found = new Map<string, Side>()
    for (const [side, key] of sidesOf(r)) {
      for (const id of index.get(`${side}\u0000${key}\u0000${r.hintKey}`) ?? []) if (!found.has(id)) found.set(id, side)
    }
    // Use the hit only if exactly one entry matches.
    if (found.size === 1) {
      const [[entryId, side]] = [...found]
      rowHits.set(r, { entryId, side })
    }
  }

  const entries = await selectIn<EntryRow>(
    db,
    [...rowHits.values()].map((h) => h.entryId),
    (inList) =>
      `SELECT id, lemma, lemma_key, translation, alt_translations_json, grammar_json FROM entries WHERE id IN (${inList})`,
  )
  const byId = new Map(entries.map((e) => [e.id, e]))
  const out = new Map<KeyedRow, Hit>()
  for (const [r, h] of rowHits) {
    const entry = byId.get(h.entryId)
    if (entry) out.set(r, { entry, side: h.side })
  }
  return out
}

/** Live cards (not duplicate/deleted) by term_key or lemma_key, oldest first, with their glosses. */
async function loadCandidates(
  db: D1Database,
  deckId: string,
  src: LanguageCode,
  termKeys: readonly string[],
  lemmaKeys: readonly string[],
): Promise<Candidate[]> {
  const select = (col: string) => (inList: string) =>
    `SELECT c.id, c.input_term, c.input_lang, c.input_side, c.term_key, c.hint_key, c.lemma_key, c.sense_key,
            c.status, c.extra_translations_json, c.created_at, c.rowid AS seq,
            e.lemma AS e_lemma, e.grammar_json AS e_grammar
     FROM cards c LEFT JOIN entries e ON e.id = c.entry_id
     WHERE c.deck_id = ? AND c.status NOT IN ('duplicate','deleted') AND c.${col} IN (${inList})`
  const rows = [
    ...(await selectIn<CandidateRow>(db, termKeys, select('term_key'), [deckId])),
    ...(await selectIn<CandidateRow>(db, lemmaKeys, select('lemma_key'), [deckId])),
  ]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const sorted = [...byId.values()].sort((a, b) => a.created_at - b.created_at || a.seq - b.seq)

  const glossRows = await selectIn<{ card_id: string; gloss_key: string }>(
    db,
    sorted.map((r) => r.id),
    (inList) => `SELECT card_id, gloss_key FROM card_glosses WHERE card_id IN (${inList})`,
  )
  const glosses = new Map<string, Set<string>>()
  for (const g of glossRows) glosses.set(g.card_id, (glosses.get(g.card_id) ?? new Set()).add(g.gloss_key))

  return sorted.map((r) => {
    const extras = parseJsonArray(r.extra_translations_json)
    // A card's glosses: card_glosses (written on resolution), plus what is known before that:
    // its hint, its extra translations and, for source-language input, the input term itself.
    const set = glosses.get(r.id) ?? new Set<string>()
    if (r.hint_key) set.add(r.hint_key)
    for (const x of extras) set.add(glossKey(src, x))
    if (r.input_side === 'source' || (r.input_side === null && r.input_lang === 'source')) set.add(glossKey(src, r.input_term))
    set.delete('')
    return {
      id: r.id,
      inputLang: r.input_lang,
      termKey: r.term_key,
      hintKey: r.hint_key,
      lemmaKey: r.lemma_key,
      senseKey: r.sense_key,
      status: r.status,
      display: cardDisplay(r.input_term, r.e_lemma, r.e_grammar),
      glosses: set,
      extras,
      planned: null,
    }
  })
}

const INSERT_COLUMNS =
  'id, deck_id, entry_id, input_term, input_hint, term_key, input_lang, input_side, hint_key, lemma_key, sense_key, status, extra_translations_json, origin, due, created_at, updated_at'

/** Multi-row INSERT OR IGNORE; ?1 = deck id, ?2 = now, then 12 values per row. */
function insertStatement(db: D1Database, deckId: string, now: number, part: readonly Planned[]): D1PreparedStatement {
  const values: unknown[] = [deckId, now]
  const tuples = part.map((p) => {
    const c = p.candidate
    const base = values.length
    values.push(
      c.id,
      p.entry?.id ?? null,
      p.row.term,
      p.row.hint ?? null,
      c.termKey,
      c.inputLang,
      p.side,
      c.hintKey,
      c.lemmaKey,
      c.senseKey,
      c.status,
      JSON.stringify(c.extras),
    )
    const n = (i: number) => `?${base + i + 1}`
    return `(${n(0)}, ?1, ${n(1)}, ${n(2)}, ${n(3)}, ${n(4)}, ${n(5)}, ${n(6)}, ${n(7)}, ${n(8)}, ${n(9)}, ${n(10)}, ${n(11)}, 'import', ?2, ?2, ?2)`
  })
  return db
    .prepare(`INSERT OR IGNORE INTO cards (${INSERT_COLUMNS}) VALUES ${tuples.join(', ')} RETURNING id`)
    .bind(...values)
}
