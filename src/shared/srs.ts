/**
 * Spaced repetition (PLAN.md section 1): FSRS through ts-fsrs v6, shared by the Worker (which
 * computes the authoritative result in POST /reviews) and the client (interval labels and the
 * in-session requeue).
 *
 * - Model: FSRS-6, selected explicitly. ts-fsrs v6 defaults to FSRS-7, whose memory state has
 *   an extra `stabilityFast` field our `cards` table does not store (docs/DECISIONS.md, M5).
 * - Config: retention 0.9, maximum interval 365 days, fuzz on, learning steps 1m/10m,
 *   relearning step 10m.
 * - Fuzz in ts-fsrs v6 is seeded by the card id (and its review count), so the same card,
 *   rating and time give the same interval on the client and the server: the button labels are
 *   exact, not approximate.
 *
 * ts-fsrs creates schedulers asynchronously (the model is loaded lazily), so call `loadSrs()`
 * once and use the synchronous `Srs` it resolves to.
 */
import { DefaultScheduler, type Rating } from 'ts-fsrs'

export type Grade = 1 | 2 | 3 | 4
export const GRADES: readonly Grade[] = [1, 2, 3, 4]
export const GRADE_LABELS: Readonly<Record<Grade, string>> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }

/** cards.state: 0 New, 1 Learning, 2 Review, 3 Relearning (same numbers as ts-fsrs State). */
export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const

export type SrsConfig = {
  desiredRetention: number
  maximumInterval: number
  enableFuzz: boolean
  learningSteps: readonly `${number}${'m' | 'h' | 'd'}`[]
  relearningSteps: readonly `${number}${'m' | 'h' | 'd'}`[]
}

export const DEFAULT_SRS_CONFIG: SrsConfig = {
  desiredRetention: 0.9,
  maximumInterval: 365,
  enableFuzz: true,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
}

/** Cards due within this window count as due now (PLAN section 4: learn-ahead 20 minutes). */
export const LEARN_AHEAD_MS = 20 * 60_000

const DAY_MS = 86_400_000

/** The FSRS columns of a `cards` row (timestamps in ms). */
export type SrsFields = {
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review: number | null
}

/** The ts-fsrs v6 card shape for the FSRS-6 default scheduler. */
export type FsrsCard = {
  cardId: string
  stability: number
  difficulty: number
  state: number
  scheduleStatus: 'new' | 'learning' | 'review'
  dueAt: Date
  lastReviewAt: Date | null
  reps: number
  lapses: number
  scheduledDays: number
  learningStep: number
}

/** Fresh FSRS state for a new card (the column defaults in migration 0001). */
export function newSrsFields(now: number): SrsFields {
  return {
    due: now,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: CardState.New,
    last_review: null,
  }
}

function scheduleStatus(state: number): FsrsCard['scheduleStatus'] {
  if (state === CardState.Review) return 'review'
  if (state === CardState.Learning || state === CardState.Relearning) return 'learning'
  return 'new'
}

/** Card row -> ts-fsrs card. `elapsed_days` is not part of the v6 card (it is derived from lastReviewAt). */
export function toFsrsCard(id: string, f: SrsFields): FsrsCard {
  return {
    cardId: id,
    stability: f.stability,
    difficulty: f.difficulty,
    state: f.state,
    scheduleStatus: scheduleStatus(f.state),
    dueAt: new Date(f.due),
    lastReviewAt: f.last_review === null ? null : new Date(f.last_review),
    reps: f.reps,
    lapses: f.lapses,
    scheduledDays: f.scheduled_days,
    learningStep: f.learning_steps,
  }
}

/**
 * ts-fsrs card -> card row fields. `elapsedDays` is stored for reference only: the days between
 * the previous review and this one (0 for a first review).
 */
export function fromFsrsCard(c: FsrsCard, elapsedDays: number): SrsFields {
  return {
    due: c.dueAt.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: elapsedDays,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningStep,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.lastReviewAt === null ? null : c.lastReviewAt.getTime(),
  }
}

export type ReviewOutcome = {
  /** The card's FSRS fields after the review. */
  after: SrsFields
  /** Whole days since the previous review (0 for the first). */
  elapsedDays: number
}

export type Srs = {
  readonly config: SrsConfig
  /** Apply a rating at `now` (ms). Pure: the input is not modified. */
  review(id: string, before: SrsFields, grade: Grade, now: number): ReviewOutcome
  /** The four outcomes (Again..Easy) at `now`, without applying any. */
  preview(id: string, before: SrsFields, now: number): Record<Grade, SrsFields>
}

// The public v6 types are generic over middleware; this is the subset we call.
type SchedulerLike = {
  review(input: { card: FsrsCard; grade: Rating; now: Date }): { card: FsrsCard }
  preview(input: { card: FsrsCard; now: Date }): Iterable<{ grade: Rating; card: FsrsCard }>
}

const cache = new Map<string, Promise<Srs>>()

/** The shared scheduler for `config` (memoised per config). */
export function loadSrs(overrides: Partial<SrsConfig> = {}): Promise<Srs> {
  const config: SrsConfig = { ...DEFAULT_SRS_CONFIG, ...overrides }
  const key = JSON.stringify(config)
  let p = cache.get(key)
  if (!p) {
    p = createSrs(config)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

async function createSrs(config: SrsConfig): Promise<Srs> {
  const scheduler = (await DefaultScheduler({
    version: 'FSRS-6',
    desiredRetention: config.desiredRetention,
    maximumInterval: config.maximumInterval,
    enableFuzz: config.enableFuzz,
    enableShortTerm: true,
    learningSteps: config.learningSteps,
    relearningSteps: config.relearningSteps,
  })) as unknown as SchedulerLike

  const elapsed = (before: SrsFields, now: number) =>
    before.last_review === null ? 0 : Math.max(0, Math.floor((now - before.last_review) / DAY_MS))

  return {
    config,
    review(id, before, grade, now) {
      const { card } = scheduler.review({ card: toFsrsCard(id, before), grade: grade as Rating, now: new Date(now) })
      const elapsedDays = elapsed(before, now)
      return { after: fromFsrsCard(card, elapsedDays), elapsedDays }
    },
    preview(id, before, now) {
      const out = {} as Record<Grade, SrsFields>
      const elapsedDays = elapsed(before, now)
      for (const item of scheduler.preview({ card: toFsrsCard(id, before), now: new Date(now) })) {
        out[item.grade as Grade] = fromFsrsCard(item.card, elapsedDays)
      }
      return out
    },
  }
}

// ---------- interval labels ----------

/** "<1m", "10m", "3h", "3d", "2mo", "1y" for a duration in ms. */
export function formatInterval(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 24) return `${Math.round(hours)}h`
  const days = ms / DAY_MS
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.max(1, Math.round(days / 30))}mo`
  const years = days / 365
  return `${Math.round(years * 10) / 10}y`.replace('.0y', 'y')
}

/** Button labels: how long until the card would be due again for each grade. */
export function previewIntervals(srs: Srs, id: string, before: SrsFields, now: number): Record<Grade, string> {
  const p = srs.preview(id, before, now)
  return { 1: formatInterval(p[1].due - now), 2: formatInterval(p[2].due - now), 3: formatInterval(p[3].due - now), 4: formatInterval(p[4].due - now) }
}

/** True when a card scheduled `after` comes back within the learn-ahead window (same session). */
export function dueWithinSession(after: SrsFields, now: number): boolean {
  return after.due <= now + LEARN_AHEAD_MS
}
