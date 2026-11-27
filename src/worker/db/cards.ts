import { mergeContent, withArticle } from '../../shared/display'
import type { LanguageCode } from '../../shared/languages'
import { collapseWhitespace, termKey } from '../../shared/normalize'
import type {
  CardDTO,
  CardListQuery,
  CardListResponse,
  CardRef,
  CardStatus,
  DeckStats,
  LearnQueueResponse,
  ReviewQueueResponse,
} from '../../shared/schemas'
import { LEARN_AHEAD_MS, type SrsFields } from '../../shared/srs'
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
  gen_error: string | null
  override_json: string | null
  note: string | null
  created_at: number
  updated_at: number
} & SrsFields

/** A card joined with its entry (and, for duplicates, the card it duplicates). */
export type CardListRow = CardRow & {
  e_lemma: string | null
  e_translation: string | null
  e_grammar: string | null
  e_pos: string | null
  e_alts: string | null
  e_cefr: string | null
  e_example_target: string | null
  e_example_source: string | null
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
  return withArticle(lemma, typeof article === 'string' ? article : null)
}

export function cardDisplay(inputTerm: string, lemma: string | null | undefined, grammarJson?: string | null): string {
  return lemma ? lemmaDisplay(lemma, grammarJson) : inputTerm
}

/** The FSRS columns of a card row. */
export function srsFields(row: SrsFields): SrsFields {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review,
  }
}

export function toCardDTO(row: CardListRow): CardDTO {
  const content =
    row.status === 'pending' || row.status === 'failed'
      ? null
      : mergeContent(
          row.e_lemma === null
            ? null
            : {
                lemma: row.e_lemma,
                pos: row.e_pos,
                translation: row.e_translation,
                alt_translations_json: row.e_alts,
                cefr: row.e_cefr,
                grammar_json: row.e_grammar,
                example_target: row.e_example_target,
                example_source: row.e_example_source,
              },
          row.override_json,
        )
  const dto: CardDTO = {
    id: row.id,
    deckId: row.deck_id,
    status: row.status,
    display: content ? withArticle(content.lemma, content.grammar?.article) : row.input_term,
    inputTerm: row.input_term,
    inputHint: row.input_hint,
    inputLang: row.input_lang,
    translation: content?.translation ?? null,
    extraTranslations: parseJsonArray(row.extra_translations_json),
    content,
    note: row.note ?? null,
    genError: row.gen_error,
    state: row.state,
    due: row.due,
    srs: srsFields(row),
    createdAt: row.created_at,
  }
  if (row.duplicate_of && row.dup_input_term !== null) {
    dto.duplicateOf = { id: row.duplicate_of, display: cardDisplay(row.dup_input_term, row.dup_lemma, row.dup_grammar) }
  }
  return dto
}

export const LIST_SELECT = `
  SELECT c.*, e.lemma AS e_lemma, e.translation AS e_translation, e.grammar_json AS e_grammar,
         e.pos AS e_pos, e.alt_translations_json AS e_alts, e.cefr AS e_cefr,
         e.example_target AS e_example_target, e.example_source AS e_example_source,
         dc.input_term AS dup_input_term,
         COALESCE(de.lemma, json_extract(dc.override_json, '$.lemma')) AS dup_lemma,
         COALESCE(de.grammar_json, json_extract(dc.override_json, '$.grammar')) AS dup_grammar
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

/**
 * GET /cards/:id: an owned, non-deleted card with `alsoInDeck` (other ready cards of the deck
 * sharing a gloss key, at most 3; DUPLICATES.md 10.6). Two queries.
 */
export async function getCard(db: D1Database, userId: string, cardId: string): Promise<CardDTO | null> {
  const row = await db
    .prepare(`${LIST_SELECT} WHERE c.id = ? AND c.status <> 'deleted' AND c.deck_id IN (SELECT id FROM decks WHERE user_id = ?)`)
    .bind(cardId, userId)
    .first<CardListRow>()
  if (!row) return null
  const dto = toCardDTO(row)
  dto.alsoInDeck = (await alsoInDeck(db, [cardId])).get(cardId) ?? []
  return dto
}

export const ALSO_IN_DECK_MAX = 3

/**
 * "Also in your deck" (DUPLICATES.md 10.6) for a batch of cards: other `ready` cards of the same
 * deck that share a card_glosses.gloss_key, at most 3 per card, oldest first. ONE self-join over
 * card_glosses for the whole batch (the ids travel as one JSON parameter).
 */
export async function alsoInDeck(db: D1Database, cardIds: readonly string[]): Promise<Map<string, CardRef[]>> {
  const out = new Map<string, CardRef[]>()
  if (cardIds.length === 0) return out
  const { results } = await db
    .prepare(
      `SELECT g.card_id AS for_id, o.id, o.input_term, o.created_at,
         COALESCE(e.lemma, json_extract(o.override_json, '$.lemma')) AS lemma,
         COALESCE(e.grammar_json, json_extract(o.override_json, '$.grammar')) AS grammar_json
       FROM json_each(?1) j
       JOIN card_glosses g ON g.card_id = j.value
       JOIN card_glosses og ON og.deck_id = g.deck_id AND og.gloss_key = g.gloss_key AND og.card_id <> g.card_id
       JOIN cards o ON o.id = og.card_id AND o.status = 'ready'
       LEFT JOIN entries e ON e.id = o.entry_id
       GROUP BY g.card_id, o.id
       ORDER BY g.card_id, o.created_at, o.id`,
    )
    .bind(JSON.stringify([...new Set(cardIds)]))
    .all<{ for_id: string; id: string; input_term: string; lemma: string | null; grammar_json: string | null }>()
  for (const r of results) {
    const list = out.get(r.for_id) ?? []
    if (list.length < ALSO_IN_DECK_MAX) list.push({ id: r.id, display: cardDisplay(r.input_term, r.lemma, r.grammar_json) })
    out.set(r.for_id, list)
  }
  return out
}

export const DEFAULT_REVIEW_LIMIT = 50

/**
 * The cards Train shows (alias `c`): already studied (Learning, Review, Relearning), or never
 * studied but imported straight to Train (skip_learn, docs/DECISIONS.md "Imports go to Train").
 */
const IN_TRAIN = '(c.state IN (1, 2, 3) OR (c.state = 0 AND c.skip_learn = 1))'

/**
 * GET /decks/:id/review: ready cards in Train (IN_TRAIN: studied, or imported to skip Learn) due within the learn-ahead
 * window, soonest first. `ahead` ("practice anyway") drops the due filter: the cards due soonest,
 * due or not. Pending, failed, suspended, duplicate and deleted cards never appear
 * (status = 'ready'). Each card carries `alsoInDeck`. 2 statements, +1 for `nextDueAt` when the
 * queue is empty.
 */
export async function reviewQueue(
  db: D1Database,
  deckId: string,
  opts: { limit?: number; ahead?: boolean; now?: number } = {},
): Promise<ReviewQueueResponse> {
  const now = opts.now ?? Date.now()
  const limit = opts.limit ?? DEFAULT_REVIEW_LIMIT
  // ahead=1: no upper bound on due (MAX_SAFE_INTEGER keeps one statement shape).
  const dueLimit = opts.ahead ? Number.MAX_SAFE_INTEGER : now + LEARN_AHEAD_MS
  const { results } = await db
    .prepare(
      `${LIST_SELECT} WHERE c.deck_id = ?1 AND c.status = 'ready' AND ${IN_TRAIN} AND c.due <= ?3
       ORDER BY c.due, c.id LIMIT ?2`,
    )
    .bind(deckId, limit, dueLimit)
    .all<CardListRow>()
  const cards = results.map(toCardDTO)
  const also = await alsoInDeck(db, cards.map((c) => c.id))
  for (const c of cards) c.alsoInDeck = also.get(c.id) ?? []
  let nextDueAt: number | null = cards[0]?.due ?? null
  if (cards.length === 0) {
    const row = await db
      .prepare(`SELECT MIN(due) AS next FROM cards c WHERE deck_id = ? AND status = 'ready' AND ${IN_TRAIN}`)
      .bind(deckId)
      .first<{ next: number | null }>()
    nextDueAt = row?.next ?? null
  }
  return { cards, nextDueAt }
}

const DAY_MS = 86_400_000

/**
 * Start of the user's local day containing `now`. `tzOffset` is the client's
 * Date#getTimezoneOffset() (minutes to add to local time to get UTC; UTC+2 -> -120); 0 = UTC.
 */
export function localDayStart(now: number, tzOffset = 0): number {
  const shift = tzOffset * 60_000
  return Math.floor((now - shift) / DAY_MS) * DAY_MS + shift
}

/**
 * "New cards first reviewed today": distinct cards of deck ?3 with a log by user ?4 since ?5 whose
 * state before the review was New. Shared by /stats and /learn so both count the same thing.
 */
const NEW_TODAY_SQL = `(SELECT COUNT(DISTINCT l.card_id) FROM review_logs l JOIN cards lc ON lc.id = l.card_id
   WHERE l.user_id = ?4 AND l.reviewed_at >= ?5 AND lc.deck_id = ?3 AND l.state_before = 0 AND lc.skip_learn = 0)`

export const DEFAULT_LEARN_LIMIT = 50

/**
 * GET /decks/:id/learn (PLAN section 4): ready New cards, oldest first (import order), each with
 * `alsoInDeck`. The page is capped at `dailyNewLimit - newToday` (the user's local day), unless
 * `extra` ("learn more anyway") is given: then up to `extra` cards regardless of the cap.
 * Pending, failed, suspended, duplicate and deleted cards never appear (status = 'ready').
 * 3 statements (counts, page, alsoInDeck); 1 when the cap leaves nothing to fetch.
 */
export async function learnQueue(
  db: D1Database,
  deckId: string,
  opts: { userId: string; dailyNewLimit: number; limit?: number; extra?: number; tzOffset?: number; now?: number },
): Promise<LearnQueueResponse> {
  const now = opts.now ?? Date.now()
  const counts = await db
    .prepare(
      `SELECT ${NEW_TODAY_SQL} AS newToday,
         (SELECT COUNT(*) FROM cards WHERE deck_id = ?3 AND status = 'ready' AND state = 0 AND skip_learn = 0) AS readyNewTotal`,
    )
    // ?1/?2 are unused here: NEW_TODAY_SQL is numbered for deckStats' statement.
    .bind(null, null, deckId, opts.userId, localDayStart(now, opts.tzOffset))
    .first<{ newToday: number; readyNewTotal: number }>()
  const newToday = counts?.newToday ?? 0
  const readyNewTotal = counts?.readyNewTotal ?? 0
  const remainingToday = Math.max(0, opts.dailyNewLimit - newToday)
  const limit = opts.limit ?? DEFAULT_LEARN_LIMIT
  const take = Math.min(limit, opts.extra ?? remainingToday, readyNewTotal)

  let cards: CardDTO[] = []
  if (take > 0) {
    const { results } = await db
      .prepare(
        `${LIST_SELECT} WHERE c.deck_id = ?1 AND c.status = 'ready' AND c.state = 0 AND c.skip_learn = 0
         ORDER BY c.created_at, c.rowid LIMIT ?2`,
      )
      .bind(deckId, take)
      .all<CardListRow>()
    cards = results.map(toCardDTO)
    const also = await alsoInDeck(db, cards.map((c) => c.id))
    for (const c of cards) c.alsoInDeck = also.get(c.id) ?? []
  }
  return { cards, remainingToday, readyNewTotal, newToday, dailyNewLimit: opts.dailyNewLimit }
}

/** Deck counts in ONE statement. Day-based counts use the client's local day (`tzOffset`). */
export async function deckStats(
  db: D1Database,
  deckId: string,
  opts: { userId: string; tzOffset?: number; now?: number },
): Promise<DeckStats> {
  const now = opts.now ?? Date.now()
  const dayStart = localDayStart(now, opts.tzOffset)
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(status NOT IN ('duplicate','deleted')), 0) AS total,
         COALESCE(SUM(status = 'ready'), 0) AS ready,
         COALESCE(SUM(status = 'pending'), 0) AS pending,
         COALESCE(SUM(status = 'failed'), 0) AS failed,
         COALESCE(SUM(status = 'suspended'), 0) AS suspended,
         COALESCE(SUM(status = 'ready' AND state = 0 AND skip_learn = 0), 0) AS "new",
         COALESCE(SUM(status = 'ready' AND state IN (1, 3)), 0) AS learning,
         COALESCE(SUM(status = 'ready' AND state = 2), 0) AS review,
         COALESCE(SUM(status = 'ready' AND (state <> 0 OR skip_learn = 1) AND due <= ?1), 0) AS dueNow,
         COALESCE(SUM(status = 'ready' AND (state <> 0 OR skip_learn = 1) AND due < ?2), 0) AS dueToday,
         COALESCE(SUM(status = 'duplicate'), 0) AS duplicates,
         COALESCE(SUM(status = 'failed' AND gen_error = 'needs_meaning'), 0) AS needsMeaning,
         (SELECT COUNT(*) FROM review_logs l JOIN cards lc ON lc.id = l.card_id
            WHERE l.user_id = ?4 AND l.reviewed_at >= ?5 AND lc.deck_id = ?3) AS reviewedToday,
         ${NEW_TODAY_SQL} AS newToday
       FROM cards WHERE deck_id = ?3`,
    )
    .bind(now + LEARN_AHEAD_MS, dayStart + DAY_MS, deckId, opts.userId, dayStart)
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

/**
 * POST /decks/:id/retry-failed: failed cards go back to pending with a fresh attempt count.
 * Duplicates (and deleted cards) are never touched, nor needs_meaning cards (retrying can't help:
 * the dictionary still doesn't know them; the user enters the meaning). One statement.
 */
export async function retryFailed(db: D1Database, deckId: string): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE cards SET status = 'pending', gen_attempts = 0, gen_error = NULL, gen_claimed_at = NULL, updated_at = ?
       WHERE deck_id = ? AND status = 'failed' AND gen_error IS NOT 'needs_meaning'`,
    )
    .bind(Date.now(), deckId)
    .run()
  return res.meta.changes
}
