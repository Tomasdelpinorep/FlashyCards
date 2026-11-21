/**
 * POST /decks/:id/suggest ("Add X new words", PLAN.md M7, docs/DUPLICATES.md section 10.7).
 *
 * Word-list path (LanguageConfig.hasWordlist): the next `count` DISTINCT lemma_keys of the
 * bundled frequency list with rank > skipTopN, excluding every lemma_key already in the deck in
 * ANY status (deleted and duplicate cards included) and the term_keys of cards whose input was
 * not in the source language. ONE query; it fetches count + 1 rows so `exhausted` can say
 * whether the list has anything left.
 *
 * AI fallback (no word list): ONE generator call asks for count x 1.2 words, excluding up to 500
 * of the deck's keys (most recent first); the answer goes through the same deck filter (one
 * query). The call costs 1 word and 1 call of the daily AI budget (DECISIONS.md M7) and fails
 * closed when AI is not configured.
 *
 * Both paths then insert through the import path (services/importer.ts insertRows, section
 * 10.3): origin='suggested', input_lang='target', no hint; a word already in the shared cache is
 * ready at once, the rest are pending for /generate.
 */
import { LANGUAGES, type LanguageCode } from '../../shared/languages'
import { termKey } from '../../shared/normalize'
import { MAX_TERM_LENGTH, type KeyedRow } from '../../shared/parseImport'
import type { SuggestResponse } from '../../shared/schemas'
import { GeneratorError, type SentenceGenerator } from '../ai/generator'
import { toGeneratorError } from '../ai/anthropic'
import { deckSettings, type DeckRow } from '../db/decks'
import { insertRows } from './importer'
import { checkBudget, consumeBudget, type Limits } from './rateLimit'

export const SUGGEST_MAX = 50
/** At most this many of the deck's keys are sent to the model as "already known". */
export const AI_EXCLUDE_LIMIT = 500
/** The fallback asks for count x 1.2 words, since some may be filtered out. */
export const AI_OVERSAMPLE = 1.2
/** Budget charged for one fallback call (only the words it later generates cost more). */
export const AI_SUGGEST_BUDGET_WORDS = 1

export class AiNotConfiguredError extends Error {}
export class SuggestRateLimitedError extends Error {
  constructor(readonly resetsAt: number) {
    super('rate_limited')
  }
}
export class SuggestAiError extends Error {}

export type SuggestOptions = {
  /** Called only on the AI fallback path, so the word-list path works without AI configured. */
  generator: () => SentenceGenerator | null
  limits: Limits
  userId: string
  now?: number
}

/** Keys the deck already "has": lemma_key of any card, term_key of non-source input. */
const DECK_HAS_KEY = (k: string) =>
  `${k} NOT IN (SELECT lemma_key FROM cards WHERE deck_id = ?1 AND lemma_key IS NOT NULL)
   AND ${k} NOT IN (SELECT term_key FROM cards WHERE deck_id = ?1 AND input_lang <> 'source')`

export async function suggestForDeck(db: D1Database, deck: DeckRow, count: number, opts: SuggestOptions): Promise<SuggestResponse> {
  const target = deck.target_lang as LanguageCode
  let words: { lemma: string; lemmaKey: string }[]
  let exhausted = false

  if (LANGUAGES[target]?.hasWordlist) {
    const { results } = await db
      .prepare(
        `SELECT w.lemma, w.lemma_key, MIN(w.rank) AS r FROM wordlist w
         WHERE w.lang = ?2 AND w.rank > ?3 AND ${DECK_HAS_KEY('w.lemma_key')}
         GROUP BY w.lemma_key ORDER BY r LIMIT ?4`,
      )
      .bind(deck.id, target, deckSettings(deck).skipTopN, count + 1)
      .all<{ lemma: string; lemma_key: string }>()
    exhausted = results.length <= count
    words = results.slice(0, count).map((r) => ({ lemma: r.lemma, lemmaKey: r.lemma_key }))
  } else {
    words = await suggestWithAi(db, deck, count, opts)
  }

  const rows: KeyedRow[] = words.map((w, i) => ({ line: i + 1, term: w.lemma, lang: 'target', termKey: w.lemmaKey, hintKey: '' }))
  const inserted = rows.length > 0 ? await insertRows(db, deck, rows, [], 'suggested') : { added: 0, ready: 0, pending: 0, duplicates: [] }
  return { ...inserted, exhausted }
}

async function suggestWithAi(db: D1Database, deck: DeckRow, count: number, opts: SuggestOptions) {
  const now = opts.now ?? Date.now()
  const target = deck.target_lang as LanguageCode
  // Fail closed before touching anything (same rule as /generate).
  const generator = opts.generator()
  if (!generator) throw new AiNotConfiguredError()

  const budget = await checkBudget(db, opts.userId, AI_SUGGEST_BUDGET_WORDS, opts.limits, now)
  if (budget.allowed < AI_SUGGEST_BUDGET_WORDS) throw new SuggestRateLimitedError(budget.resetsAt)

  const { results: known } = await db
    .prepare(
      `SELECT k FROM (
         SELECT lemma_key AS k, created_at FROM cards WHERE deck_id = ?1 AND lemma_key IS NOT NULL
         UNION ALL
         SELECT term_key, created_at FROM cards WHERE deck_id = ?1 AND input_lang <> 'source'
       ) GROUP BY k ORDER BY MAX(created_at) DESC LIMIT ?2`,
    )
    .bind(deck.id, AI_EXCLUDE_LIMIT)
    .all<{ k: string }>()

  if (!(await consumeBudget(db, opts.userId, AI_SUGGEST_BUDGET_WORDS, opts.limits, now))) {
    throw new SuggestRateLimitedError(budget.resetsAt)
  }

  let suggested
  try {
    suggested = await generator.suggestWords({
      sourceLang: deck.source_lang as LanguageCode,
      targetLang: target,
      level: deckSettings(deck).sentenceLevel,
      count: Math.ceil(count * AI_OVERSAMPLE),
      exclude: known.map((r) => r.k),
    })
  } catch (err) {
    const e = err instanceof GeneratorError ? err : toGeneratorError(err)
    console.warn('word suggestion failed', e.message)
    throw new SuggestAiError(e.message)
  }

  // Normalise: NFC, no leading article, sane length; one entry per key, in the model's order.
  const articles = LANGUAGES[target].articles
  const seen = new Set<string>()
  const candidates: { lemma: string; lemmaKey: string }[] = []
  for (const w of suggested) {
    let lemma = w.lemma.normalize('NFC').trim()
    const lower = lemma.toLowerCase()
    const article = articles.find((a) => lower.startsWith(`${a} `) && lemma.length > a.length + 1)
    if (article) lemma = lemma.slice(article.length + 1).trim()
    const lemmaKey = termKey(target, lemma)
    if (!lemmaKey || lemma.length > MAX_TERM_LENGTH || seen.has(lemmaKey)) continue
    seen.add(lemmaKey)
    candidates.push({ lemma, lemmaKey })
  }
  if (candidates.length === 0) return []

  // The same deck filter as the word-list path (the model may ignore, or not see, the exclusions).
  const { results: kept } = await db
    .prepare(`SELECT j.key AS i FROM json_each(?2) j WHERE ${DECK_HAS_KEY('j.value')} ORDER BY j.key`)
    .bind(deck.id, JSON.stringify(candidates.map((c) => c.lemmaKey)))
    .all<{ i: number }>()
  return kept.slice(0, count).map((r) => candidates[r.i]!)
}
