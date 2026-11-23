/**
 * POST /cards/:id/meaning: the user's own meaning for a 'failed' card (a word the curated
 * dictionary doesn't know, gen_error 'needs_meaning'; also any other failed card).
 *
 * The meaning lives in cards.override_json with entry_id NULL (mergeContent builds the card's
 * content from the override alone), so nothing reaches the shared cache. The card becomes
 * 'ready' with lemma_key = termKey(target, word) and its card_glosses written by the same rule
 * /generate uses (resolvedCardGlosses), all in ONE db.batch. The UPDATE is guarded like
 * /generate's ready statement: only while still 'failed', and only if no other live card of the
 * deck has the same lemma (and sense); otherwise nothing changes and the caller gets 409
 * already_in_deck (this also covers the cards_lemma_uq race).
 */
import { LANGUAGES, type LanguageCode } from '../../shared/languages'
import { termKey } from '../../shared/normalize'
import type { CardDTO, CardRef, MeaningInput } from '../../shared/schemas'
import type { ContentOverride } from '../../shared/display'
import { cardDisplay, getCard } from '../db/cards'
import { parseJsonArray } from '../db/util'
import { cleanSentence, fixGender } from './generation'
import { glossInsertStatement, resolvedCardGlosses, type Side } from './resolve'

export type FillMeaningResult =
  | { card: CardDTO }
  | { error: 'not_found' }
  | { error: 'not_failed'; status: string }
  | { error: 'already_in_deck'; existing: CardRef | null }

type Row = {
  id: string
  deck_id: string
  status: string
  input_term: string
  input_lang: 'target' | 'source' | 'auto'
  term_key: string
  hint_key: string
  extra_translations_json: string
  source_lang: LanguageCode
  target_lang: LanguageCode
}

/** Split a leading article off the word: "der Hund" -> { lemma: "Hund", article: "der" }. */
export function splitArticle(lang: LanguageCode, word: string): { lemma: string; article: string | null } {
  const w = word.normalize('NFC').replace(/\s+/gu, ' ').trim()
  const lower = w.toLowerCase()
  for (const a of LANGUAGES[lang].articles) {
    if (lower.startsWith(`${a} `) && w.length > a.length + 1) return { lemma: w.slice(a.length + 1).trim(), article: a }
  }
  return { lemma: w, article: null }
}

/** The override_json of a user-entered meaning (exported for tests). */
export function meaningOverride(target: LanguageCode, input: MeaningInput): { override: ContentOverride; lemma: string } {
  const { lemma, article } = splitArticle(target, input.word)
  const g = fixGender(
    {
      gender: input.gender ?? null,
      article,
      plural: null,
      genitive: null,
      verb: null,
      governs_case: null,
      comparative: null,
      superlative: null,
      note: null,
    },
    LANGUAGES[target].genderArticles,
  )
  const override: ContentOverride = {
    lemma,
    pos: g.gender ? 'noun' : null,
    translation: input.translation.trim(),
    grammar: { gender: g.gender, article: g.gender ? g.article : null },
  }
  const exampleTarget = cleanSentence(input.exampleTarget)
  const exampleSource = cleanSentence(input.exampleSource)
  if (exampleTarget) override.exampleTarget = exampleTarget
  if (exampleSource) override.exampleSource = exampleSource
  return { override, lemma }
}

export async function fillMeaning(db: D1Database, userId: string, cardId: string, input: MeaningInput): Promise<FillMeaningResult> {
  const row = await db
    .prepare(
      `SELECT c.id, c.deck_id, c.status, c.input_term, c.input_lang, c.term_key, c.hint_key, c.extra_translations_json,
              d.source_lang, d.target_lang
       FROM cards c JOIN decks d ON d.id = c.deck_id
       WHERE c.id = ? AND c.status <> 'deleted' AND d.user_id = ?`,
    )
    .bind(cardId, userId)
    .first<Row>()
  if (!row) return { error: 'not_found' }
  if (row.status !== 'failed') return { error: 'not_failed', status: row.status }

  const { override, lemma } = meaningOverride(row.target_lang, input)
  const lemmaKey = termKey(row.target_lang, lemma)
  // What was typed was in the target language unless it was declared (or, for auto input,
  // looks like) the source language.
  const side: Side =
    row.input_lang === 'source' ? 'source' : row.input_lang === 'target' ? 'target' : lemmaKey === row.term_key ? 'target' : 'source'
  const glosses = resolvedCardGlosses(
    row.source_lang,
    { translation: override.translation ?? null, alt_translations_json: '[]' },
    { hintKey: row.hint_key, inputTerm: row.input_term, side, extras: parseJsonArray(row.extra_translations_json) },
  )
  const now = Date.now()
  const [updated] = await db.batch<{ id: string }>([
    db
      .prepare(
        `UPDATE cards SET entry_id = NULL, override_json = ?1, lemma_key = ?2, sense_key = cards.hint_key, input_side = ?3,
           status = 'ready', gen_error = NULL, gen_claimed_at = NULL, updated_at = ?4
         WHERE cards.id = ?5 AND cards.status = 'failed'
           AND NOT EXISTS (SELECT 1 FROM cards e WHERE e.deck_id = cards.deck_id AND e.lemma_key = ?2
                           AND e.id <> cards.id AND e.status NOT IN ('duplicate','deleted')
                           AND (cards.hint_key = '' OR e.sense_key = cards.hint_key))
         RETURNING cards.id`,
      )
      .bind(JSON.stringify(override), lemmaKey, side, now, cardId),
    db.prepare(`DELETE FROM card_glosses WHERE card_id = ?1 AND EXISTS (SELECT 1 FROM cards WHERE id = ?1 AND status = 'ready')`).bind(cardId),
    glossInsertStatement(
      db,
      [...glosses].map((g): [string, string] => [cardId, g]),
      "WHERE c.status = 'ready'",
    ),
  ])
  if (!updated || updated.results.length === 0) {
    const fresh = await db.prepare('SELECT status FROM cards WHERE id = ?').bind(cardId).first<{ status: string }>()
    if (fresh && fresh.status !== 'failed') return { error: 'not_failed', status: fresh.status }
    const existing = await db
      .prepare(
        `SELECT o.id, o.input_term, COALESCE(e.lemma, json_extract(o.override_json, '$.lemma')) AS lemma,
                COALESCE(e.grammar_json, json_extract(o.override_json, '$.grammar')) AS grammar_json
         FROM cards o LEFT JOIN entries e ON e.id = o.entry_id
         WHERE o.deck_id = ? AND o.lemma_key = ? AND o.id <> ? AND o.status NOT IN ('duplicate','deleted')
         ORDER BY o.created_at LIMIT 1`,
      )
      .bind(row.deck_id, lemmaKey, cardId)
      .first<{ id: string; input_term: string; lemma: string | null; grammar_json: string | null }>()
    return { error: 'already_in_deck', existing: existing ? { id: existing.id, display: cardDisplay(existing.input_term, existing.lemma, existing.grammar_json) } : null }
  }
  const card = await getCard(db, userId, cardId)
  return card ? { card } : { error: 'not_found' }
}
