/**
 * The Train session queue (PLAN.md sections 2 and 6), kept pure so it is unit-tested without a
 * browser. Cards come from GET /review in due order. A graded card whose new due time falls
 * within the learn-ahead window (a learning or relearning step: 1m, 10m) goes back into the
 * in-memory queue with its updated schedule and is shown again once it is due, or earlier when
 * nothing else is left.
 */
import type { CardDTO } from '../../shared/schemas'
import { dueWithinSession, LEARN_AHEAD_MS, type Grade, type SrsFields } from '../../shared/srs'

export type Session = {
  /** Cards not yet shown, in the order the server returned them. */
  queue: CardDTO[]
  /** Cards graded this session that come back soon (learning steps), with their new schedule. */
  again: CardDTO[]
  /** Reviews made this session. */
  reviewed: number
  /** Reviews rated Hard, Good or Easy. */
  correct: number
}

export function startSession(cards: readonly CardDTO[]): Session {
  return { queue: [...cards], again: [], reviewed: 0, correct: 0 }
}

/**
 * The card to show at `now`: a requeued card that is due, else the next new one from the
 * queue, else the requeued card due soonest if it is within the learn-ahead window. null = done.
 */
export function currentCard(s: Session, now: number): CardDTO | null {
  const again = [...s.again].sort((a, b) => a.srs.due - b.srs.due)
  if (again[0] && again[0].srs.due <= now) return again[0]
  if (s.queue[0]) return s.queue[0]
  if (again[0] && again[0].srs.due <= now + LEARN_AHEAD_MS) return again[0]
  return null
}

/** Record a grade for `card` (scheduled `after`) and return the next session state. */
export function gradeCard(s: Session, card: CardDTO, grade: Grade, after: SrsFields, now: number): Session {
  const queue = s.queue.filter((c) => c.id !== card.id)
  const again = s.again.filter((c) => c.id !== card.id)
  if (dueWithinSession(after, now)) again.push({ ...card, srs: after, state: after.state, due: after.due })
  return { queue, again, reviewed: s.reviewed + 1, correct: s.correct + (grade > 1 ? 1 : 0) }
}

/** The soonest time a requeued card comes back (for "next card in ..."), or null. */
export function nextAgainAt(s: Session): number | null {
  return s.again.reduce<number | null>((m, c) => (m === null || c.srs.due < m ? c.srs.due : m), null)
}
