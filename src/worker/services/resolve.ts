/**
 * Duplicate-resolution building blocks shared by /import and /generate (docs/DUPLICATES.md
 * sections 10.1, 10.3 and 10.4).
 *
 * Query budget (docs/DECISIONS.md, M4): D1 on the Workers Free plan allows ~50 queries per
 * invocation and counts every statement of a db.batch. Every helper here therefore issues a
 * fixed number of statements however many rows it handles: key lists travel as ONE JSON
 * parameter and are expanded with json_each() instead of chunked IN (...) lists.
 */
import type { LanguageCode } from '../../shared/languages'
import { glossKey, termKey } from '../../shared/normalize'
import type { InputLang, LanguagePair } from '../../shared/parseImport'
import type { CardStatus } from '../../shared/schemas'
import { cardDisplay } from '../db/cards'
import { parseJsonArray } from '../db/util'

export const MAX_EXTRA_TRANSLATIONS = 10

export type Side = 'target' | 'source'

/** The entry columns duplicate checks and displays need. */
export type EntryRow = {
  id: string
  lemma: string
  lemma_key: string
  sense_key: string
  translation: string | null
  alt_translations_json: string | null
  grammar_json: string | null
}

/** A live card in the deck, or one the current request is about to insert or resolve. */
export type Candidate = {
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
  /** True for cards created/resolved by the current request (not yet in the database as such). */
  planned: boolean
  /** Set when a planned insert lost a race: the card that won. */
  winner?: Candidate
}

/** What an alias lookup needs to know about an input. */
export type AliasQuery = { lang: InputLang; term: string; termKey: string; hintKey: string }
export type AliasHit = { entry: EntryRow; side: Side }

/** Alias key of `term` on one side (auto input is looked up with each side's own key). */
export function sideKey(pair: LanguagePair, q: AliasQuery, side: Side): string {
  if (q.lang !== 'auto') return q.termKey
  return termKey(side === 'target' ? pair.targetLang : pair.sourceLang, q.term)
}

function sidesOf(pair: LanguagePair, q: AliasQuery): [Side, string][] {
  const sides: Side[] = q.lang === 'auto' ? ['target', 'source'] : [q.lang]
  return sides.map((side) => [side, sideKey(pair, q, side)])
}

const ENTRY_COLS = 'e.id, e.lemma, e.lemma_key, e.sense_key, e.translation, e.alt_translations_json, e.grammar_json'

/**
 * ONE query: entry_aliases joined to entries for every input's keys. A hit counts only if
 * exactly one entry matches (by input_side, alias key and hint key).
 */
export async function lookupAliases<Q extends AliasQuery>(
  db: D1Database,
  pair: LanguagePair,
  queries: readonly Q[],
): Promise<Map<Q, AliasHit>> {
  const out = new Map<Q, AliasHit>()
  const keys = [...new Set(queries.flatMap((q) => sidesOf(pair, q).map(([, k]) => k)))]
  if (keys.length === 0) return out
  const { results } = await db
    .prepare(
      `SELECT a.input_side, a.alias_key, a.sense_key AS alias_sense, ${ENTRY_COLS}
       FROM entry_aliases a JOIN entries e ON e.id = a.entry_id
       WHERE a.source_lang = ?1 AND a.target_lang = ?2 AND a.alias_key IN (SELECT value FROM json_each(?3))`,
    )
    .bind(pair.sourceLang, pair.targetLang, JSON.stringify(keys))
    .all<EntryRow & { input_side: Side; alias_key: string; alias_sense: string }>()

  const index = new Map<string, EntryRow[]>()
  for (const { input_side, alias_key, alias_sense, ...entry } of results) {
    const k = `${input_side}\u0000${alias_key}\u0000${alias_sense}`
    index.set(k, [...(index.get(k) ?? []), entry])
  }
  for (const q of queries) {
    const found = new Map<string, AliasHit>()
    for (const [side, key] of sidesOf(pair, q)) {
      for (const entry of index.get(`${side}\u0000${key}\u0000${q.hintKey}`) ?? []) {
        if (!found.has(entry.id)) found.set(entry.id, { entry, side })
      }
    }
    if (found.size === 1) out.set(q, [...found.values()][0]!)
  }
  return out
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
  glosses_json: string
}

/**
 * ONE query: live cards (not duplicate/deleted) of the deck with a matching term_key or
 * lemma_key, oldest first, each with its card_glosses.
 */
export async function loadCandidates(
  db: D1Database,
  deckId: string,
  src: LanguageCode,
  termKeys: readonly string[],
  lemmaKeys: readonly string[],
): Promise<Candidate[]> {
  if (termKeys.length === 0 && lemmaKeys.length === 0) return []
  const { results } = await db
    .prepare(
      `SELECT c.id, c.input_term, c.input_lang, c.input_side, c.term_key, c.hint_key, c.lemma_key, c.sense_key,
              c.status, c.extra_translations_json, c.created_at, c.rowid AS seq,
              e.lemma AS e_lemma, e.grammar_json AS e_grammar,
              (SELECT json_group_array(g.gloss_key) FROM card_glosses g WHERE g.card_id = c.id) AS glosses_json
       FROM cards c LEFT JOIN entries e ON e.id = c.entry_id
       WHERE c.deck_id = ?1 AND c.status NOT IN ('duplicate','deleted')
         AND (c.term_key IN (SELECT value FROM json_each(?2)) OR c.lemma_key IN (SELECT value FROM json_each(?3)))
       ORDER BY c.created_at, c.rowid`,
    )
    .bind(deckId, JSON.stringify([...new Set(termKeys)]), JSON.stringify([...new Set(lemmaKeys)]))
    .all<CandidateRow>()

  return results.map((r) => {
    const extras = parseJsonArray(r.extra_translations_json)
    // A card's glosses: card_glosses (written on resolution), plus what is known before that:
    // its hint, its extra translations and, for source-language input, the input term itself.
    const set = new Set(parseJsonArray(r.glosses_json))
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
      planned: false,
    }
  })
}

/** Gloss keys of a resolved card: the entry's translation and alternatives, plus the hint. */
export function entryGlosses(src: LanguageCode, entry: EntryRow, hintKey: string): Set<string> {
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
export function findDuplicate(
  candidates: readonly Candidate[],
  src: LanguageCode,
  entry: EntryRow,
  hintKey: string,
  glossesN: ReadonlySet<string>,
  exceptId?: string,
): Candidate | undefined {
  const translationKey = entry.translation ? glossKey(src, entry.translation) : ''
  return candidates.find(
    (e) =>
      e.id !== exceptId &&
      e.lemmaKey === entry.lemma_key &&
      (hintKey === '' ||
        e.senseKey === hintKey ||
        e.glosses.has(hintKey) ||
        (translationKey !== '' && e.glosses.has(translationKey)) ||
        (e.hintKey !== '' && glossesN.has(e.hintKey))),
  )
}

/** sourceWord(r) of DUPLICATES.md 10.3: the source-language word an input brings. */
export function sourceWord(side: Side | null, term: string, hint: string | null | undefined): string | null {
  if (side === 'source') return term
  if (side === 'target') return hint ?? null
  return null
}

export type Merge = { cardId: string; word: string; gloss: string }

/**
 * mergeTranslation(E, w) decided in memory: returns the merge to persist (and updates E's
 * glosses/extras so later rows in the same request see it), or null when w is already one of
 * E's glosses or E has 10 extras.
 */
export function planMerge(src: LanguageCode, e: Candidate, w: string | null): Merge | null {
  if (!w) return null
  const g = glossKey(src, w)
  if (!g || e.glosses.has(g) || e.extras.length >= MAX_EXTRA_TRANSLATIONS) return null
  e.glosses.add(g)
  e.extras.push(w)
  return { cardId: e.id, word: w, gloss: g }
}

/**
 * Persist merges with TWO statements whatever their number:
 *  1. append each word to its card's extra_translations_json unless already present, capped at
 *     10 (an idempotent, race-safe json rewrite: the guard lives in the statement);
 *  2. INSERT OR IGNORE the gloss keys (joined to cards, so a vanished card adds nothing).
 */
export function mergeStatements(db: D1Database, merges: readonly Merge[], now: number): D1PreparedStatement[] {
  if (merges.length === 0) return []
  const pairs = JSON.stringify(merges.map((m) => [m.cardId, m.word]))
  return [
    db
      .prepare(
        `UPDATE cards SET
           extra_translations_json = (
             SELECT json_group_array(v) FROM (
               SELECT v FROM (
                 SELECT x.value AS v, 0 AS grp, x.key AS k FROM json_each(cards.extra_translations_json) x
                 UNION ALL
                 SELECT json_extract(m.value, '$[1]'), 1, m.key FROM json_each(?1) m
                 WHERE json_extract(m.value, '$[0]') = cards.id
                   AND NOT EXISTS (SELECT 1 FROM json_each(cards.extra_translations_json) y
                                   WHERE y.value = json_extract(m.value, '$[1]'))
               ) ORDER BY grp, k LIMIT ${MAX_EXTRA_TRANSLATIONS}
             )
           ),
           updated_at = ?2
         WHERE id IN (SELECT json_extract(value, '$[0]') FROM json_each(?1))`,
      )
      .bind(pairs, now),
    glossInsertStatement(
      db,
      merges.map((m) => [m.cardId, m.gloss]),
    ),
  ]
}

/** ONE statement writing [cardId, glossKey] pairs to card_glosses (joined to cards, optionally filtered). */
export function glossInsertStatement(db: D1Database, pairs: readonly [string, string][], cardFilter = ''): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO card_glosses (deck_id, gloss_key, card_id)
       SELECT c.deck_id, json_extract(j.value, '$[1]'), c.id
       FROM json_each(?1) j JOIN cards c ON c.id = json_extract(j.value, '$[0]') ${cardFilter}`,
    )
    .bind(JSON.stringify(pairs))
}
