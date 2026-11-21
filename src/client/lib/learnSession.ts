/**
 * The Learn-new session (PLAN.md section 6), kept pure so it is unit-tested without a browser.
 *
 * New cards come from GET /learn, oldest first, and are taken in groups of 5:
 *   1. intro: each card of the group is shown with both sides. "Got it" sends it to the quick
 *      check (no review yet); "I already know this" is rated Easy by the caller and the card
 *      leaves the session.
 *   2. check: the M5 Train queue (lib/session.ts) over the group's "got it" cards. Cards still in
 *      a learning step (1m, 10m) are requeued there and come back until they graduate.
 *   3. the next group starts once the check has nothing due right now: its own cards were all
 *      graded once and no requeued card is due. Requeued cards then come back between the next
 *      group's check cards as they come due, and after the last group they are shown early
 *      (the 20-minute learn-ahead) until they graduate.
 *   4. done when nothing is left: the caller shows the summary.
 *
 * Resuming after a reload: the server is the source of truth (grades are in the outbox, which
 * drains first). New cards still New on the server come back through /learn, and cards this
 * session left mid-step come back from /review as `carried` (see Learn.tsx).
 */
import type { CardDTO } from '../../shared/schemas'
import { CardState, type Grade, type SrsFields } from '../../shared/srs'
import { currentCard, gradeCard, startSession, type Session } from './session'

export const LEARN_GROUP_SIZE = 5
/** "Learn 5 more" (GET /learn?extra=5) once the daily new limit is reached. */
export const LEARN_MORE_STEP = 5

export type LearnSession = {
  /** New cards not yet introduced, in server order. */
  upcoming: CardDTO[]
  /** The current group's cards waiting for their intro. */
  intro: CardDTO[]
  /** The quick check (the M5 session queue): "got it" cards plus requeued learning steps. */
  check: Session
  /** Ids of cards graded in the quick check this session ("words learned"). */
  learned: string[]
  /** Cards marked "I already know this". */
  alreadyKnew: number
  groupSize: number
}

export type LearnStep = { kind: 'intro'; card: CardDTO } | { kind: 'check'; card: CardDTO } | { kind: 'done' }

export function startLearn(
  cards: readonly CardDTO[],
  opts: { now: number; carried?: readonly CardDTO[]; learned?: readonly string[]; alreadyKnew?: number; groupSize?: number },
): LearnSession {
  const carried = opts.carried ?? []
  const carriedIds = new Set(carried.map((c) => c.id))
  const s: LearnSession = {
    upcoming: cards.filter((c) => !carriedIds.has(c.id)),
    intro: [],
    check: { ...startSession([]), again: [...carried] },
    learned: [...new Set([...(opts.learned ?? []), ...carried.map((c) => c.id)])],
    alreadyKnew: opts.alreadyKnew ?? 0,
    groupSize: opts.groupSize ?? LEARN_GROUP_SIZE,
  }
  return advance(s, opts.now)
}

/** True when the quick check has something to show right now (not counting learn-ahead). */
function checkHasDueWork(check: Session, now: number): boolean {
  return check.queue.length > 0 || check.again.some((c) => c.srs.due <= now)
}

/** Start the next group when the intro is empty and the check has nothing due now. */
function advance(s: LearnSession, now: number): LearnSession {
  if (s.intro.length > 0 || s.upcoming.length === 0 || checkHasDueWork(s.check, now)) return s
  return { ...s, intro: s.upcoming.slice(0, s.groupSize), upcoming: s.upcoming.slice(s.groupSize) }
}

/** What to show at `now`. */
export function learnStep(s: LearnSession, now: number): LearnStep {
  const intro = s.intro[0]
  if (intro) return { kind: 'intro', card: intro }
  const card = currentCard(s.check, now)
  if (card) return { kind: 'check', card }
  return { kind: 'done' }
}

/** "Got it" on the intro card: it goes to the quick check, no review is posted. */
export function gotIt(s: LearnSession, cardId: string, now: number): LearnSession {
  const card = s.intro.find((c) => c.id === cardId)
  if (!card) return s
  const intro = s.intro.filter((c) => c.id !== cardId)
  return advance({ ...s, intro, check: { ...s.check, queue: [...s.check.queue, card] } }, now)
}

/** "I already know this": the caller posts an Easy review; the card leaves the session. */
export function alreadyKnow(s: LearnSession, cardId: string, now: number): LearnSession {
  if (!s.intro.some((c) => c.id === cardId)) return s
  return advance({ ...s, intro: s.intro.filter((c) => c.id !== cardId), alreadyKnew: s.alreadyKnew + 1 }, now)
}

/** A grade in the quick check (scheduled `after`): requeued while in a learning step. */
export function gradeCheck(s: LearnSession, card: CardDTO, grade: Grade, after: SrsFields, now: number): LearnSession {
  const learned = s.learned.includes(card.id) ? s.learned : [...s.learned, card.id]
  return advance({ ...s, check: gradeCard(s.check, card, grade, after, now), learned }, now)
}

/** Re-evaluate group boundaries as time passes (a requeued card may have come due). */
export function tick(s: LearnSession, now: number): LearnSession {
  return advance(s, now)
}

/** Cards still to go: not introduced, in the intro, or in the check (including requeued steps). */
export function remainingCount(s: LearnSession): number {
  return s.upcoming.length + s.intro.length + s.check.queue.length + s.check.again.length
}

/** Ids this session has touched (for resuming after a reload). */
export function touchedIds(s: LearnSession): string[] {
  return [...new Set([...s.learned, ...s.check.again.map((c) => c.id)])]
}

// ---------- resume after a reload ----------

/** What survives a reload (sessionStorage): the cards in flight and the summary counters. */
export type LearnResume = { deckId: string; touched: string[]; learned: string[]; alreadyKnew: number; savedAt: number }

export const LEARN_RESUME_KEY = 'flashcards.learn.v1'
/** An older record is a different sitting: start counting from zero. */
export const LEARN_RESUME_MAX_AGE_MS = 6 * 3_600_000

type SessionStore = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export function saveResume(storage: SessionStore | null, deckId: string, s: LearnSession, now: number): void {
  const record: LearnResume = { deckId, touched: touchedIds(s), learned: s.learned, alreadyKnew: s.alreadyKnew, savedAt: now }
  try {
    storage?.setItem(LEARN_RESUME_KEY, JSON.stringify(record))
  } catch {
    // No storage: a reload simply starts a fresh session (grades are safe in the outbox).
  }
}

export function loadResume(storage: SessionStore | null, deckId: string, now: number): LearnResume | null {
  try {
    const raw = storage?.getItem(LEARN_RESUME_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<LearnResume>
    if (r.deckId !== deckId || typeof r.savedAt !== 'number' || now - r.savedAt > LEARN_RESUME_MAX_AGE_MS) return null
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { deckId, touched: ids(r.touched), learned: ids(r.learned), alreadyKnew: Number(r.alreadyKnew) || 0, savedAt: r.savedAt }
  } catch {
    return null
  }
}

export function clearResume(storage: SessionStore | null): void {
  try {
    storage?.removeItem(LEARN_RESUME_KEY)
  } catch {
    // ignore
  }
}

/**
 * Rebuild a session from the server after a reload. `learnCards` = GET /learn (still New on the
 * server); `reviewCards` = GET /review (studied cards due within the learn-ahead). Cards this
 * session touched that are still in a learning step continue their steps; New cards with a review
 * still waiting in the outbox (`pendingIds`, offline) are left out so they are not introduced twice.
 */
export function resumeLearn(
  learnCards: readonly CardDTO[],
  reviewCards: readonly CardDTO[],
  resume: LearnResume | null,
  pendingIds: ReadonlySet<string>,
  now: number,
): LearnSession {
  const touched = new Set(resume?.touched ?? [])
  const carried = reviewCards.filter((c) => touched.has(c.id) && (c.srs.state === CardState.Learning || c.srs.state === CardState.Relearning))
  return startLearn(
    learnCards.filter((c) => !pendingIds.has(c.id)),
    { now, carried, learned: resume?.learned ?? [], alreadyKnew: resume?.alreadyKnew ?? 0 },
  )
}
