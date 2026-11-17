import type { LanguageCode } from '../../shared/languages'
import { collapseWhitespace, termKey } from '../../shared/normalize'
import type { CardDTO, CardListQuery, CardListResponse, CardStatus, DeckStats } from '../../shared/schemas'
import { parseJsonArray } from './util'

export type CardRow = {
  id: string
  deck_id: string
  entry_id: string | null
  input_term: string
  input_hint: string | null
  term_key: string
  input_lang: 'target' | 'source' | 'auto'
  input_side: 'target' | 'source' | null
  hint_key: string
  lemma_key: string | null
  sense_key: string | null
  extra_translations_json: string
  duplicate_of: string | null
  status: CardStatus
  state: number
  due: number
  created_at: number
}

/** A card joined with its entry (and, for duplicates, the card it duplicates). */
export type CardListRow = CardRow & {
  e_lemma: string | null
  e_translation: string | null
  e_grammar: string | null
  dup_input_term: string | null
  dup_lemma: string | null
  dup_grammar: string | null
}

/** Lemma with its article when the entry's grammar has one ("Hund" + der -> "der Hund"). */
export function lemmaDisplay(lemma: string, grammarJson: string | null | undefined): string {
  let article: unknown
  try {
    article = (JSON.parse(grammarJson ?? 'null') as { article?: unknown } | null)?.article
  } catch {
    article = undefined
  }
  if (typeof article === 'string' && article.trim() && !lemma.toLowerCase().startsWith(`${article.trim().toLowerCase()} `)) {
    return `${article.trim()} ${lemma}`
  }
  return lemma
}

export function cardDisplay(inputTerm: string, lemma: string | null | undefined, grammarJson?: string | null): string {
  return lemma ? lemmaDisplay(lemma, grammarJson) : inputTerm
}

export function toCardDTO(row: CardListRow): CardDTO {
  const dto: CardDTO = {
    id: row.id,
    deckId: row.deck_id,
    status: row.status,
    display: cardDisplay(row.input_term, row.e_lemma, row.e_grammar),
    inputTerm: row.input_term,
    inputHint: row.input_hint,
    inputLang: row.input_lang,
    translation: row.e_translation,
    extraTranslations: parseJsonArray(row.extra_translations_json),
    state: row.state,
    due: row.due,
    createdAt: row.created_at,
  }
  if (row.duplicate_of && row.dup_input_term !== null) {
    dto.duplicateOf = { id: row.duplicate_of, display: cardDisplay(row.dup_input_term, row.dup_lemma, row.dup_grammar) }
  }
  return dto
}

const LIST_SELECT = `
  SELECT c.*, e.lemma AS e_lemma, e.translation AS e_translation, e.grammar_json AS e_grammar,
         dc.input_term AS dup_input_term, de.lemma AS dup_lemma, de.grammar_json AS dup_grammar
  FROM cards c
  LEFT JOIN entries e ON e.id = c.entry_id
  LEFT JOIN cards dc ON dc.id = c.duplicate_of
  LEFT JOIN entries de ON de.id = dc.entry_id`

export const DEFAULT_CARD_PAGE = 50

function encodeCursor(row: CardRow): string {
  return `${row.created_at}_${row.id}`
}

function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  const i = cursor.indexOf('_')
  const createdAt = Number(cursor.slice(0, i))
  if (i <= 0 || !Number.isSafeInteger(createdAt)) return null
  return { createdAt, id: cursor.slice(i + 1) }
}

/**
 * Cards of a deck, newest first, with keyset pagination on (created_at, id).
 * Without a status filter, duplicate and deleted cards are left out (DUPLICATES.md 10.6);
 * deleted cards are never listed.
 */
export async function listCards(
  db: D1Database,
  deckId: string,
  targetLang: LanguageCode,
  query: CardListQuery,
): Promise<CardListResponse | null> {
  const where: string[] = ['c.deck_id = ?']
  const params: unknown[] = [deckId]
  if (query.status) {
    where.push('c.status = ?')
    params.push(query.status)
  } else {
    where.push("c.status NOT IN ('duplicate','deleted')")
  }
  const q = collapseWhitespace((query.q ?? '').normalize('NFC')).toLowerCase()
  if (q) {
    const like = (v: string) => `%${v.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
    const key = termKey(targetLang, q) || q
    // Raw text against what was typed and the translations; the query's term key
    // ("der Hund" -> "hund") against the card's term and lemma keys.
    const cols: [string, string][] = [
      ['lower(c.input_term)', like(q)],
      ['c.hint_key', like(q)],
      ['lower(e.lemma)', like(q)],
      ['lower(e.translation)', like(q)],
      ['lower(c.extra_translations_json)', like(q)],
      ['c.term_key', like(key)],
      ['c.lemma_key', like(key)],
    ]
    where.push(`(${cols.map(([col]) => `${col} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    params.push(...cols.map(([, v]) => v))
  }
  if (query.cursor) {
    const cur = decodeCursor(query.cursor)
    if (!cur) return null
    where.push('(c.created_at < ? OR (c.created_at = ? AND c.id < ?))')
    params.push(cur.createdAt, cur.createdAt, cur.id)
  }
  const limit = query.limit ?? DEFAULT_CARD_PAGE
  const { results } = await db
    .prepare(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`)
    .bind(...params, limit + 1)
    .all<CardListRow>()
  const page = results.slice(0, limit)
  return {
    cards: page.map(toCardDTO),
    nextCursor: results.length > limit ? encodeCursor(page[page.length - 1]!) : null,
  }
}

export async function deckStats(db: D1Database, deckId: string, now = Date.now()): Promise<DeckStats> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(status NOT IN ('duplicate','deleted')), 0) AS total,
         COALESCE(SUM(status = 'ready'), 0) AS ready,
         COALESCE(SUM(status = 'pending'), 0) AS pending,
         COALESCE(SUM(status = 'failed'), 0) AS failed,
         COALESCE(SUM(status = 'suspended'), 0) AS suspended,
         COALESCE(SUM(status = 'ready' AND state = 0), 0) AS "new",
         COALESCE(SUM(status = 'ready' AND state IN (1, 3)), 0) AS learning,
         COALESCE(SUM(status = 'ready' AND state = 2), 0) AS review,
         COALESCE(SUM(status = 'ready' AND state <> 0 AND due <= ?), 0) AS dueNow,
         COALESCE(SUM(status = 'duplicate'), 0) AS duplicates
       FROM cards WHERE deck_id = ?`,
    )
    .bind(now, deckId)
    .first<DeckStats>()
  return row!
}

/**
 * Soft-delete a card the user owns (status -> 'deleted') and drop its glosses, so it is never
 * a duplicate target again. Idempotent. Returns false when the card is missing or not owned.
 */
export async function softDeleteCard(db: D1Database, userId: string, cardId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE cards SET status = 'deleted', gen_claimed_at = NULL,
         updated_at = CASE WHEN status = 'deleted' THEN updated_at ELSE ? END
       WHERE id = ? AND deck_id IN (SELECT id FROM decks WHERE user_id = ?) RETURNING id`,
    )
    .bind(Date.now(), cardId, userId)
    .first<{ id: string }>()
  if (!row) return false
  await db.prepare('DELETE FROM card_glosses WHERE card_id = ?').bind(cardId).run()
  return true
}
