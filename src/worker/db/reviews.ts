/**
 * POST /reviews (PLAN.md sections 2 and 4): apply one FSRS rating to a card, idempotently.
 *
 * The client-supplied UUID is review_logs.id. D1 has no interactive transactions, so the guard
 * lives in the two statements of ONE db.batch, both compare-and-swap on the card's pre-review
 * state (reps, last_review), which every review changes:
 *
 *   1. INSERT OR IGNORE INTO review_logs ... SELECT ... WHERE the card is ready and still at the
 *      state we read
 *   2. UPDATE cards SET <new FSRS state> WHERE the card is still at the state we read AND our
 *      log row (this id, this card, this reviewed_at) exists ... RETURNING
 *
 * - Same id posted twice, concurrently: batches are serialised, so the second finds the card
 *   moved on (its CAS fails) and the id already logged. It re-reads, sees its own log row and
 *   returns the current card unchanged (`applied: false`). Applied exactly once.
 * - A different id raced us on the same card: our CAS fails and no log row exists, so we
 *   recompute from the fresh state (up to MAX_ATTEMPTS times; then 503 so the outbox retries).
 *
 * Statements per call: 1 read + 1 batch of 2 (+3 per CAS retry). Plus auth.
 */
import { REVIEW_MAX_AGE_MS, type CardStatus, type ReviewInput, type ReviewResponse } from '../../shared/schemas'
import type { Srs, SrsFields } from '../../shared/srs'
import { srsFields } from './cards'

const MAX_ATTEMPTS = 3

type ReviewRow = SrsFields & { id: string; status: CardStatus; log_card: string | null; log_user: string | null }

export type ReviewResult =
  | { ok: true; response: ReviewResponse }
  | { ok: false; status: 404 | 409 | 503; error: 'not_found' | 'card_not_ready' | 'review_id_conflict' | 'review_conflict' }

const SRS_COLS = 'due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review'

/** reviewedAt clamped to [now - 7 days, now] (PLAN section 4). */
export function clampReviewedAt(reviewedAt: number, now: number): number {
  return Math.min(now, Math.max(now - REVIEW_MAX_AGE_MS, reviewedAt))
}

export async function submitReview(
  db: D1Database,
  userId: string,
  input: ReviewInput,
  srs: Srs,
  now = Date.now(),
): Promise<ReviewResult> {
  const clamped = clampReviewedAt(input.reviewedAt, now)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Ownership + current state + whether this review id is already logged, in one read.
    const row = await db
      .prepare(
        `SELECT c.id, c.status, ${SRS_COLS.split(', ').map((col) => `c.${col}`).join(', ')},
                l.card_id AS log_card, l.user_id AS log_user
         FROM cards c
         JOIN decks d ON d.id = c.deck_id AND d.user_id = ?2
         LEFT JOIN review_logs l ON l.id = ?3
         WHERE c.id = ?1 AND c.status <> 'deleted'`,
      )
      .bind(input.cardId, userId, input.id)
      .first<ReviewRow>()
    if (!row) return { ok: false, status: 404, error: 'not_found' }
    if (row.log_card !== null) {
      // Idempotent repeat: return the card as it is now.
      if (row.log_card === input.cardId && row.log_user === userId) {
        return { ok: true, response: { card: { id: row.id, status: row.status, srs: srsFields(row) }, applied: false } }
      }
      return { ok: false, status: 409, error: 'review_id_conflict' }
    }
    if (row.status !== 'ready') return { ok: false, status: 409, error: 'card_not_ready' }

    const before = srsFields(row)
    // Never before the previous review (a late outbox post after a newer one from another device).
    const reviewedAt = Math.max(clamped, before.last_review ?? 0)
    const { after } = srs.review(row.id, before, input.rating, reviewedAt)

    const [, updated] = await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO review_logs
             (id, card_id, user_id, rating, direction, state_before, due_before, stability_after,
              difficulty_after, scheduled_days, reviewed_at, duration_ms)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
           WHERE EXISTS (SELECT 1 FROM cards WHERE id = ?2 AND status = 'ready' AND reps = ?13 AND last_review IS ?14)`,
        )
        .bind(
          input.id,
          row.id,
          userId,
          input.rating,
          input.direction,
          before.state,
          before.due,
          after.stability,
          after.difficulty,
          after.scheduled_days,
          reviewedAt,
          input.durationMs ?? null,
          before.reps,
          before.last_review,
        ),
      db
        .prepare(
          `UPDATE cards SET due = ?3, stability = ?4, difficulty = ?5, elapsed_days = ?6, scheduled_days = ?7,
             learning_steps = ?8, reps = ?9, lapses = ?10, state = ?11, last_review = ?12, updated_at = ?13
           WHERE id = ?1 AND status = 'ready' AND reps = ?14 AND last_review IS ?15
             AND EXISTS (SELECT 1 FROM review_logs WHERE id = ?2 AND card_id = ?1 AND reviewed_at = ?16)
           RETURNING id, status, ${SRS_COLS}`,
        )
        .bind(
          row.id,
          input.id,
          after.due,
          after.stability,
          after.difficulty,
          after.elapsed_days,
          after.scheduled_days,
          after.learning_steps,
          after.reps,
          after.lapses,
          after.state,
          after.last_review,
          now,
          before.reps,
          before.last_review,
          reviewedAt,
        ),
    ])
    const card = (updated?.results as (SrsFields & { id: string; status: CardStatus })[] | undefined)?.[0]
    if (card) return { ok: true, response: { card: { id: card.id, status: card.status, srs: srsFields(card) }, applied: true } }
    // CAS failed: a concurrent post (same id -> idempotent next round; other id -> recompute).
  }
  return { ok: false, status: 503, error: 'review_conflict' }
}
