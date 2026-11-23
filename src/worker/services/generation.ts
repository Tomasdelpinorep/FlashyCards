/**
 * POST /decks/:id/generate, implementing PLAN.md section 2 step 3 and docs/DUPLICATES.md
 * section 10.4:
 *
 *   1. claim up to 10 pending cards with a 90 s lease on gen_claimed_at (one guarded UPDATE)
 *   2. alias lookup (the global cache, seeded with the curated dictionary): hits cost nothing
 *   3. cache misses -> daily budget (only misses count) -> ONE batched AI call; without a
 *      generator (no AI configured, the default) a miss is final: 'failed' + 'needs_meaning',
 *      and the user types the meaning (services/fillMeaning.ts)
 *   4. entries INSERT ... ON CONFLICT DO NOTHING, aliases INSERT OR IGNORE, read the winners
 *   5. per card in created_at order: batchSeen ?? findDuplicate -> duplicate (+ mergeTranslation),
 *      otherwise 'ready' through the guarded UPDATE ... NOT EXISTS (all in one statement)
 *   6. cards whose guard failed (a parallel request readied the same lemma) are re-read and
 *      marked duplicate of the card that won
 *
 * Query budget: a fixed number of D1 statements per call whatever the batch holds (about 20;
 * the test asserts <= 30). Lists travel as one JSON parameter expanded with json_each().
 */
import { hasValidMarkers, stripMarkers } from '../../shared/display'
import { LANGUAGES, type LanguageCode } from '../../shared/languages'
import { glossKey, termKey } from '../../shared/normalize'
import type { InputLang, LanguagePair } from '../../shared/parseImport'
import type { DuplicateReport, GenerateResponse } from '../../shared/schemas'
import { GeneratorError, type GenerationInput, type SentenceGenerator } from '../ai/generator'
import { toGeneratorError } from '../ai/anthropic'
import { PROMPT_VERSION } from '../ai/prompts'
import { PERSON_KEYS, type GeneratedItem, type Grammar, type VerbTable } from '../ai/schema'
import { lemmaDisplay } from '../db/cards'
import { deckSettings, type DeckRow } from '../db/decks'
import { checkBudget, consumeBudget, type Limits } from './rateLimit'
import {
  findDuplicate,
  glossInsertStatement,
  loadCandidates,
  lookupAliases,
  mergeStatements,
  planMerge,
  resolvedCardGlosses,
  sideKey,
  sourceWord,
  type AliasQuery,
  type Candidate,
  type EntryRow,
  type Merge,
  type Side,
} from './resolve'

export const GENERATE_BATCH = 10
export const LEASE_MS = 90_000
export const MAX_ATTEMPTS = 3
/** gen_error of a card the dictionary does not know (no AI): the user enters the meaning. */
export const NEEDS_MEANING = 'needs_meaning'
const MAX_ALT_TRANSLATIONS = 3

type ClaimedRow = {
  id: string
  input_term: string
  input_hint: string | null
  term_key: string
  input_lang: InputLang
  hint_key: string
  created_at: number
  seq: number
  /** Word-list POS of a suggested card (null otherwise). */
  pos_hint: string | null
}

/** A claimed card, usable as an alias query. */
type Claimed = AliasQuery & { row: ClaimedRow }

/** How a claimed card was resolved to an entry. */
type Resolution = { entry: EntryRow; side: Side; fromCache: boolean }

/** A batch of identical inputs sent to the AI once. */
type MissGroup = { key: string; cards: Claimed[]; input: GenerationInput }

/** The fields of an entry to insert (post-validated AI output). */
type NewEntry = {
  lemma: string
  lemma_key: string
  sense_key: string
  pos: string | null
  translation: string
  alts: string[]
  cefr: string | null
  grammar: Grammar | null
  example_target: string | null
  example_source: string | null
}

/** `generator: null` = no AI: cache misses become needs_meaning at once (no budget, no call). */
export type GenerateOptions = { generator: SentenceGenerator | null; limits: Limits; userId: string; now?: number }

export async function generateForDeck(db: D1Database, deck: DeckRow, opts: GenerateOptions): Promise<GenerateResponse> {
  const now = opts.now ?? Date.now()
  const pair: LanguagePair = { sourceLang: deck.source_lang as LanguageCode, targetLang: deck.target_lang as LanguageCode }
  const src = pair.sourceLang
  const response: GenerateResponse = { processed: 0, fromCache: 0, generated: 0, failed: 0, needsMeaning: 0, remaining: 0, rateLimited: false, duplicates: [] }

  // 1. Claim (one statement). Cards whose lease expired (a Worker died) are claimable again.
  // Suggested cards also return their word-list POS, which goes to the model as `pos` only
  // (never stored as input_hint, so hint_key and duplicate semantics are untouched; M7).
  const { results: claimedRows } = await db
    .prepare(
      `UPDATE cards SET gen_claimed_at = ?1
       WHERE id IN (SELECT id FROM cards WHERE deck_id = ?2 AND status = 'pending'
                    AND (gen_claimed_at IS NULL OR gen_claimed_at < ?3)
                    ORDER BY created_at, rowid LIMIT ?4)
       RETURNING id, input_term, input_hint, term_key, input_lang, hint_key, created_at, rowid AS seq,
         CASE WHEN origin = 'suggested' THEN (SELECT w.pos FROM wordlist w WHERE w.lang = ?5 AND w.lemma_key = cards.term_key
                                              ORDER BY w.rank LIMIT 1) END AS pos_hint`,
    )
    .bind(now, deck.id, now - LEASE_MS, GENERATE_BATCH, deck.target_lang)
    .all<ClaimedRow>()
  if (claimedRows.length === 0) {
    response.remaining = await countPending(db, deck.id)
    return response
  }
  const claimed: Claimed[] = claimedRows
    .sort((a, b) => a.created_at - b.created_at || a.seq - b.seq)
    .map((row) => ({ row, lang: row.input_lang, term: row.input_term, termKey: row.term_key, hintKey: row.hint_key }))

  // 2. Alias lookup (one query).
  const resolution = new Map<Claimed, Resolution>()
  const hits = await lookupAliases(db, pair, claimed)
  for (const [c, hit] of hits) resolution.set(c, { entry: hit.entry, side: hit.side, fromCache: true })

  // Group identical misses so each distinct input is generated once.
  const groups = new Map<string, MissGroup>()
  for (const c of claimed) {
    if (resolution.has(c)) continue
    const key = `${c.lang}\u0000${c.termKey}\u0000${c.hintKey}`
    const g = groups.get(key)
    if (g) g.cards.push(c)
    else groups.set(key, { key, cards: [c], input: { input: c.term, hint: c.row.input_hint, inputLang: c.lang, ...(c.row.pos_hint ? { pos: c.row.pos_hint } : {}) } })
  }

  // 3. Budget (two queries when there are misses): only cache misses count. Without a generator
  // a miss is final at once: the user enters the meaning.
  const generator = opts.generator
  const failures: [id: string, error: string, final: 0 | 1][] = []
  let toGenerate = [...groups.values()]
  const deferred: Claimed[] = []
  if (!generator) {
    for (const g of toGenerate) for (const c of g.cards) failures.push([c.row.id, NEEDS_MEANING, 1])
    toGenerate = []
  }
  if (toGenerate.length > 0) {
    const budget = await checkBudget(db, opts.userId, toGenerate.length, opts.limits, now)
    if (budget.allowed < toGenerate.length) {
      response.rateLimited = true
      response.limitResetsAt = budget.resetsAt
    }
    let allowed = budget.allowed
    if (allowed > 0 && !(await consumeBudget(db, opts.userId, allowed, opts.limits, now))) allowed = 0 // lost a race: retry later
    for (const g of toGenerate.slice(allowed)) deferred.push(...g.cards)
    toGenerate = toGenerate.slice(0, allowed)
  }

  // 4. One AI call for the misses, then post-validation.
  const newEntries: { group: MissGroup; entry: NewEntry; side: Side }[] = []
  if (generator && toGenerate.length > 0) {
    try {
      const items = await generator.generate({
        sourceLang: pair.sourceLang,
        targetLang: pair.targetLang,
        level: deckSettings(deck).sentenceLevel,
        items: toGenerate.map((g) => g.input),
      })
      const matched = matchItems(
        toGenerate.map((g) => g.input.input),
        items,
      )
      toGenerate.forEach((g, i) => {
        const item = matched[i]
        const v = item ? validateItem(item, g, pair) : ({ kind: 'invalid', reason: 'missing from the response' } as const)
        if (v.kind === 'not_a_word') for (const c of g.cards) failures.push([c.row.id, 'not_a_word', 1])
        else if (v.kind === 'invalid') for (const c of g.cards) failures.push([c.row.id, v.reason, 0])
        else newEntries.push({ group: g, entry: v.entry, side: v.side })
      })
    } catch (err) {
      const e = err instanceof GeneratorError ? err : toGeneratorError(err)
      console.warn('generation failed', e.message)
      for (const g of toGenerate) for (const c of g.cards) failures.push([c.row.id, e.message.slice(0, 200), 0])
    }
  }

  // 5. Entries + aliases + winners (one batch of three statements).
  if (generator && newEntries.length > 0) {
    const byKey = await persistEntries(db, pair, newEntries, generator.model, now)
    for (const { group, entry, side } of newEntries) {
      const row = byKey.get(`${entry.lemma_key}\u0000${entry.sense_key}`)
      if (!row) {
        for (const c of group.cards) failures.push([c.row.id, 'entry not stored', 0])
        continue
      }
      for (const c of group.cards) resolution.set(c, { entry: row, side, fromCache: false })
    }
  }

  // 6. Decide per card, in created_at order (one query for the deck's live cards with these lemmas).
  const resolvedCards = claimed.filter((c) => resolution.has(c))
  const candidates = await loadCandidates(
    db,
    deck.id,
    src,
    [],
    resolvedCards.map((c) => resolution.get(c)!.entry.lemma_key),
  )
  const batchSeen: Candidate[] = []
  const readyPlan: { c: Claimed; res: Resolution; cand: Candidate }[] = []
  const dupPlan: { c: Claimed; res: Resolution; target: Candidate; merge: Merge | null }[] = []
  const merges: Merge[] = []
  for (const c of resolvedCards) {
    const res = resolution.get(c)!
    const glossesN = cardGlosses(src, res, c)
    const target =
      findDuplicate(batchSeen, src, res.entry, c.hintKey, glossesN) ?? findDuplicate(candidates, src, res.entry, c.hintKey, glossesN)
    if (target) {
      const merge = planMerge(src, target, sourceWord(res.side, c.term, c.row.input_hint))
      if (merge) merges.push(merge)
      dupPlan.push({ c, res, target, merge })
      continue
    }
    const cand: Candidate = {
      id: c.row.id,
      inputLang: c.lang,
      termKey: c.termKey,
      hintKey: c.hintKey,
      lemmaKey: res.entry.lemma_key,
      senseKey: c.hintKey,
      status: 'ready',
      display: lemmaDisplay(res.entry.lemma, res.entry.grammar_json),
      glosses: glossesN,
      extras: [],
      planned: true,
    }
    batchSeen.push(cand)
    readyPlan.push({ c, res, cand })
  }

  // 7. Phase A: one batch with a bounded number of statements.
  const statements: { key: string; stmt: D1PreparedStatement }[] = []
  const add = (key: string, stmt: D1PreparedStatement | undefined) => stmt && statements.push({ key, stmt })
  add('ready', readyStatement(db, readyPlan, now))
  if (readyPlan.length > 0) {
    add(
      'readyGlosses',
      glossInsertStatement(
        db,
        readyPlan.flatMap(({ cand }) => [...cand.glosses].map((g): [string, string] => [cand.id, g])),
        "WHERE c.status = 'ready'",
      ),
    )
  }
  add('dups', duplicateStatement(db, dupPlan.map((d) => ({ cardId: d.c.row.id, targetId: d.target.id, res: d.res, hintKey: d.c.hintKey })), now))
  for (const s of mergeStatements(db, merges, now)) add('merge', s)
  add('failures', failureStatement(db, failures, now))
  add('release', releaseStatement(db, deferred.map((c) => c.row.id)))
  add('remaining', db.prepare("SELECT COUNT(*) AS n FROM cards WHERE deck_id = ? AND status = 'pending'").bind(deck.id))

  const results = await db.batch<Record<string, unknown>>(statements.map((s) => s.stmt))
  const resultOf = (key: string) => results[statements.findIndex((s) => s.key === key)]?.results ?? []
  const readyIds = new Set(resultOf('ready').map((r) => r.id as string))
  const dupIds = new Set(resultOf('dups').map((r) => r.id as string))
  const failedRows = resultOf('failures').filter((r) => r.status === 'failed')
  const failed = failedRows.length
  response.needsMeaning = failedRows.filter((r) => r.gen_error === NEEDS_MEANING).length
  let remaining = Number(resultOf('remaining')[0]?.n ?? 0)

  const count = (res: Resolution) => {
    if (res.fromCache) response.fromCache++
    else response.generated++
  }
  for (const r of readyPlan) if (readyIds.has(r.c.row.id)) count(r.res)
  for (const d of dupPlan) {
    if (!dupIds.has(d.c.row.id)) continue // deleted meanwhile
    count(d.res)
    response.duplicates.push(report(d.c, d.target, d.merge))
  }

  // 8. Phase B (rare): cards whose guard failed because a parallel request readied the same lemma.
  const losers = readyPlan.filter((r) => !readyIds.has(r.c.row.id))
  if (losers.length > 0) {
    const fresh = await loadCandidates(
      db,
      deck.id,
      src,
      losers.map((l) => l.c.termKey),
      losers.map((l) => l.res.entry.lemma_key),
    )
    const lateDups: { cardId: string; targetId: string; res: Resolution; hintKey: string }[] = []
    const lateMerges: Merge[] = []
    const repoint: [from: string, to: string][] = []
    const release: string[] = []
    for (const l of losers) {
      if (!fresh.some((f) => f.id === l.c.row.id && f.status === 'pending')) continue // deleted meanwhile
      const target = findDuplicate(fresh, src, l.res.entry, l.c.hintKey, l.cand.glosses, l.c.row.id)
      if (!target) {
        release.push(l.c.row.id)
        continue
      }
      const merge = planMerge(src, target, sourceWord(l.res.side, l.c.term, l.c.row.input_hint))
      if (merge) lateMerges.push(merge)
      lateDups.push({ cardId: l.c.row.id, targetId: target.id, res: l.res, hintKey: l.c.hintKey })
      repoint.push([l.c.row.id, target.id])
      count(l.res)
      remaining--
      response.duplicates.push(report(l.c, target, merge))
      // Cards of this batch that were marked duplicate of the loser now point at the winner.
      for (const r of response.duplicates) if (r.existing.id === l.c.row.id) r.existing = { id: target.id, display: target.display, status: target.status }
    }
    const late = [
      duplicateStatement(db, lateDups, now),
      ...mergeStatements(db, lateMerges, now),
      repoint.length > 0
        ? db
            .prepare(
              `UPDATE cards SET duplicate_of = json_extract(j.value, '$[1]')
               FROM json_each(?1) j WHERE cards.duplicate_of = json_extract(j.value, '$[0]') AND cards.status = 'duplicate'`,
            )
            .bind(JSON.stringify(repoint))
        : undefined,
      releaseStatement(db, release),
    ].filter((s): s is D1PreparedStatement => !!s)
    if (late.length > 0) await db.batch(late)
  }

  response.failed = failed
  response.processed = response.fromCache + response.generated + failed
  response.remaining = Math.max(0, remaining)
  return response
}

function report(c: Claimed, target: Candidate, merge: Merge | null): DuplicateReport {
  return {
    input: c.term,
    ...(c.row.input_hint ? { hint: c.row.input_hint } : {}),
    reason: 'resolved',
    existing: { id: target.id, display: target.display, status: target.status },
    addedTranslation: merge?.word ?? null,
  }
}

/** A resolved card's glosses: entry translation + alternatives + hint, plus the input for source-side input. */
function cardGlosses(src: LanguageCode, res: Resolution, c: Claimed): Set<string> {
  return resolvedCardGlosses(src, res.entry, { hintKey: c.hintKey, inputTerm: c.term, side: res.side })
}

async function countPending(db: D1Database, deckId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM cards WHERE deck_id = ? AND status = 'pending'").bind(deckId).first<{ n: number }>()
  return Number(row?.n ?? 0)
}

// ---------- statements (each handles any number of cards) ----------

/**
 * ONE guarded UPDATE readying every card of the plan: only while still pending, and only if no
 * other live card of the deck has the same lemma (and, with a hint, the same sense). Cards that
 * fail the guard are simply not returned (DUPLICATES.md 10.4/10.5).
 */
function readyStatement(db: D1Database, plan: readonly { c: Claimed; res: Resolution }[], now: number) {
  if (plan.length === 0) return undefined
  const data = plan.map(({ c, res }) => [c.row.id, res.entry.id, res.entry.lemma_key, res.side])
  return db
    .prepare(
      `UPDATE cards SET entry_id = json_extract(j.value, '$[1]'), lemma_key = json_extract(j.value, '$[2]'),
         sense_key = cards.hint_key, input_side = json_extract(j.value, '$[3]'), status = 'ready',
         gen_claimed_at = NULL, gen_error = NULL, updated_at = ?2
       FROM json_each(?1) j
       WHERE cards.id = json_extract(j.value, '$[0]') AND cards.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM cards e WHERE e.deck_id = cards.deck_id AND e.lemma_key = json_extract(j.value, '$[2]')
                         AND e.id <> cards.id AND e.status NOT IN ('duplicate','deleted')
                         AND (cards.hint_key = '' OR e.sense_key = cards.hint_key))
       RETURNING cards.id`,
    )
    .bind(JSON.stringify(data), now)
}

/** ONE statement: markDuplicate for every card (only while still pending). */
function duplicateStatement(
  db: D1Database,
  dups: readonly { cardId: string; targetId: string; res: Resolution; hintKey: string }[],
  now: number,
) {
  if (dups.length === 0) return undefined
  const data = dups.map((d) => [d.cardId, d.targetId, d.res.entry.id, d.res.entry.lemma_key, d.res.side])
  return db
    .prepare(
      `UPDATE cards SET status = 'duplicate', duplicate_of = json_extract(j.value, '$[1]'),
         entry_id = json_extract(j.value, '$[2]'), lemma_key = json_extract(j.value, '$[3]'), sense_key = cards.hint_key,
         input_side = json_extract(j.value, '$[4]'), gen_claimed_at = NULL, gen_error = NULL, updated_at = ?2
       FROM json_each(?1) j
       WHERE cards.id = json_extract(j.value, '$[0]') AND cards.status = 'pending'
       RETURNING cards.id`,
    )
    .bind(JSON.stringify(data), now)
}

/**
 * ONE statement for every failure: count an attempt and release the lease; a final failure
 * (not_a_word) or the 3rd attempt marks the card 'failed'.
 */
function failureStatement(db: D1Database, failures: readonly [string, string, 0 | 1][], now: number) {
  if (failures.length === 0) return undefined
  return db
    .prepare(
      `UPDATE cards SET gen_attempts = cards.gen_attempts + 1, gen_error = json_extract(j.value, '$[1]'),
         status = CASE WHEN json_extract(j.value, '$[2]') = 1 OR cards.gen_attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE cards.status END,
         gen_claimed_at = NULL, updated_at = ?2
       FROM json_each(?1) j
       WHERE cards.id = json_extract(j.value, '$[0]') AND cards.status = 'pending'
       RETURNING cards.id, cards.status, cards.gen_error`,
    )
    .bind(JSON.stringify(failures), now)
}

/** ONE statement releasing leases (rate-limited or unresolvable cards are retried by a later call). */
function releaseStatement(db: D1Database, ids: readonly string[]) {
  if (ids.length === 0) return undefined
  return db
    .prepare(`UPDATE cards SET gen_claimed_at = NULL WHERE id IN (SELECT value FROM json_each(?1)) AND status = 'pending'`)
    .bind(JSON.stringify(ids))
}

/**
 * Entries + aliases in ONE batch of three statements:
 *  - INSERT INTO entries ... ON CONFLICT DO NOTHING (the global cache is never overwritten;
 *    a parallel request that inserted the same lemma/sense first wins)
 *  - INSERT OR IGNORE INTO entry_aliases: (input_side, term key, hint key) and
 *    ('target', lemma_key, sense_key) -> the winning entry
 *  - SELECT the winning rows
 */
async function persistEntries(
  db: D1Database,
  pair: LanguagePair,
  items: readonly { group: MissGroup; entry: NewEntry; side: Side }[],
  model: string,
  now: number,
): Promise<Map<string, EntryRow>> {
  const entries = items.map(({ entry: e }) => [
    crypto.randomUUID(),
    e.lemma,
    e.lemma_key,
    e.sense_key,
    e.pos,
    e.translation,
    JSON.stringify(e.alts),
    e.cefr,
    e.grammar ? JSON.stringify(e.grammar) : null,
    e.example_target,
    e.example_source,
  ])
  const aliases = items.flatMap(({ group, entry: e, side }) => {
    const c = group.cards[0]!
    return [
      [side, sideKey(pair, c, side), e.sense_key, e.lemma_key],
      ['target', e.lemma_key, e.sense_key, e.lemma_key],
    ]
  })
  const keys = items.map(({ entry: e }) => [e.lemma_key, e.sense_key])
  const col = (i: number) => `json_extract(j.value, '$[${i}]')`
  const [, , winners] = await db.batch<EntryRow>([
    db
      .prepare(
        `INSERT INTO entries (id, source_lang, target_lang, lemma, lemma_key, sense_key, pos, translation,
           alt_translations_json, cefr, grammar_json, example_target, example_source, model, prompt_version, created_at)
         SELECT ${col(0)}, ?2, ?3, ${col(1)}, ${col(2)}, ${col(3)}, ${col(4)}, ${col(5)}, ${col(6)}, ${col(7)}, ${col(8)}, ${col(9)}, ${col(10)}, ?4, ?5, ?6
         FROM json_each(?1) j WHERE true ORDER BY j.key
         ON CONFLICT (source_lang, target_lang, lemma_key, sense_key) DO NOTHING`,
      )
      .bind(JSON.stringify(entries), pair.sourceLang, pair.targetLang, model, PROMPT_VERSION, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO entry_aliases (source_lang, target_lang, input_side, alias_key, sense_key, entry_id)
         SELECT ?2, ?3, ${col(0)}, ${col(1)}, ${col(2)}, e.id
         FROM json_each(?1) j JOIN entries e ON e.source_lang = ?2 AND e.target_lang = ?3
           AND e.lemma_key = ${col(3)} AND e.sense_key = ${col(2)}`,
      )
      .bind(JSON.stringify(aliases), pair.sourceLang, pair.targetLang),
    db
      .prepare(
        `SELECT e.id, e.lemma, e.lemma_key, e.sense_key, e.translation, e.alt_translations_json, e.grammar_json
         FROM json_each(?1) j JOIN entries e ON e.source_lang = ?2 AND e.target_lang = ?3
           AND e.lemma_key = ${col(0)} AND e.sense_key = ${col(1)}`,
      )
      .bind(JSON.stringify(keys), pair.sourceLang, pair.targetLang),
  ])
  return new Map(winners!.results.map((r) => [`${r.lemma_key}\u0000${r.sense_key}`, r]))
}

// ---------- post-validation ----------

/** Match outputs to inputs by `input` (exact, then case/space-insensitive), falling back to position. */
export function matchItems(inputs: readonly string[], items: readonly GeneratedItem[]): (GeneratedItem | undefined)[] {
  const used = new Set<number>()
  const norm = (s: string) => s.normalize('NFC').trim().toLowerCase()
  const take = (pred: (it: GeneratedItem) => boolean) => {
    const i = items.findIndex((it, idx) => !used.has(idx) && pred(it))
    if (i < 0) return undefined
    used.add(i)
    return items[i]
  }
  const out = inputs.map((input) => take((it) => it.input === input))
  inputs.forEach((input, i) => {
    out[i] ??= take((it) => norm(it.input) === norm(input))
  })
  inputs.forEach((_, i) => {
    if (!out[i] && items.length === inputs.length && !used.has(i)) {
      used.add(i)
      out[i] = items[i]
    }
  })
  return out
}

type Validated =
  | { kind: 'ok'; entry: NewEntry; side: Side }
  | { kind: 'not_a_word' }
  | { kind: 'invalid'; reason: string }

/**
 * Check and normalise one AI item: required fields, lemma without a leading article, at most 3
 * alternative translations, article/gender agreement (languages.ts genderArticles), and [[ ]]
 * markers (a sentence without valid markers is stored without them).
 */
export function validateItem(item: GeneratedItem, group: Pick<MissGroup, 'input' | 'cards'>, pair: LanguagePair): Validated {
  if (item.status === 'not_a_word') return { kind: 'not_a_word' }
  const target = LANGUAGES[pair.targetLang]
  const translation = item.translation?.trim()
  let lemma = item.lemma?.normalize('NFC').trim() ?? ''
  if (!lemma || !translation) return { kind: 'invalid', reason: 'incomplete item' }

  const grammar = item.grammar ? fixVerbTables(fixGender(item.grammar, target.genderArticles)) : null
  // "der Hund" -> "Hund": the article lives in grammar.article.
  for (const a of target.articles) {
    if (lemma.toLowerCase().startsWith(`${a} `) && lemma.length > a.length + 1) {
      lemma = lemma.slice(a.length + 1)
      break
    }
  }
  const lemmaKey = termKey(pair.targetLang, lemma)
  if (!lemmaKey) return { kind: 'invalid', reason: 'incomplete item' }

  const seen = new Set([glossKey(pair.sourceLang, translation)])
  const alts: string[] = []
  for (const a of item.alt_translations ?? []) {
    const t = a.trim()
    const k = glossKey(pair.sourceLang, t)
    if (!t || seen.has(k)) continue
    seen.add(k)
    alts.push(t)
    if (alts.length >= MAX_ALT_TRANSLATIONS) break
  }

  const declared = group.input.inputLang
  const side: Side = declared === 'auto' ? item.input_side : declared
  return {
    kind: 'ok',
    side,
    entry: {
      lemma,
      lemma_key: lemmaKey,
      sense_key: group.cards[0]!.hintKey,
      pos: item.pos,
      translation,
      alts,
      cefr: item.cefr,
      grammar,
      example_target: cleanSentence(item.example_target),
      example_source: cleanSentence(item.example_source),
    },
  }
}

/** A verb table with any empty slot is dropped as a whole (null): never show a half table. */
export function fixVerbTables(g: Grammar): Grammar {
  if (!g.verb) return g
  const clean = (t: VerbTable | null | undefined): VerbTable | null => {
    if (!t) return null
    const out = {} as VerbTable
    for (const k of PERSON_KEYS) {
      const v = t[k]?.normalize('NFC').trim()
      if (!v) return null
      out[k] = v
    }
    return out
  }
  return { ...g, verb: { ...g.verb, present: clean(g.verb.present), past: clean(g.verb.past) } }
}

/** Trim; a sentence without valid [[ ]] markers is kept without them. */
export function cleanSentence(s: string | null | undefined): string | null {
  const t = s?.trim()
  if (!t) return null
  return hasValidMarkers(t) ? t : stripMarkers(t)
}

/**
 * The article must agree with the gender: a known gender wins and sets the article; a known
 * article alone sets the gender. Languages without genderArticles are left as they are.
 */
export function fixGender(g: Grammar, genderArticles: Readonly<Partial<Record<'masculine' | 'feminine' | 'neuter', string>>> | undefined): Grammar {
  if (!genderArticles) return g
  const out = { ...g }
  const article = g.article?.trim().toLowerCase() || null
  if (g.gender && genderArticles[g.gender]) {
    out.article = genderArticles[g.gender]!
  } else if (article) {
    const gender = (Object.keys(genderArticles) as (keyof typeof genderArticles)[]).find((k) => genderArticles[k] === article)
    out.gender = gender ?? null
    out.article = gender ? article : null
  }
  return out
}
