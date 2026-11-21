import { describe, expect, it } from 'vitest'
import {
  CardState,
  dueWithinSession,
  formatInterval,
  fromFsrsCard,
  loadSrs,
  newSrsFields,
  previewIntervals,
  toFsrsCard,
  type SrsFields,
} from '../../src/shared/srs'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0)

/** A card in Review state, last seen 10 days ago and due now. */
const reviewCard = (): SrsFields => ({
  due: NOW,
  stability: 10,
  difficulty: 5,
  elapsed_days: 0,
  scheduled_days: 10,
  learning_steps: 0,
  reps: 4,
  lapses: 0,
  state: CardState.Review,
  last_review: NOW - 10 * DAY,
})

describe('srs row <-> ts-fsrs card mapping', () => {
  it('round-trips a reviewed card and a new card', () => {
    for (const f of [reviewCard(), newSrsFields(NOW), { ...reviewCard(), state: CardState.Relearning, learning_steps: 1, lapses: 2 }]) {
      const card = toFsrsCard('card-1', f)
      expect(card.cardId).toBe('card-1')
      expect(fromFsrsCard(card, f.elapsed_days)).toEqual(f)
    }
  })

  it('maps states to schedule statuses', () => {
    expect(toFsrsCard('x', newSrsFields(NOW)).scheduleStatus).toBe('new')
    expect(toFsrsCard('x', { ...reviewCard(), state: 1 }).scheduleStatus).toBe('learning')
    expect(toFsrsCard('x', { ...reviewCard(), state: 3 }).scheduleStatus).toBe('learning')
    expect(toFsrsCard('x', reviewCard()).scheduleStatus).toBe('review')
    expect(toFsrsCard('x', newSrsFields(NOW)).lastReviewAt).toBeNull()
  })
})

describe('srs scheduling (FSRS-6, retention 0.9, max 365d, steps 1m/10m, relearning 10m)', () => {
  it('a new card rated Good enters learning with the 10m step', async () => {
    const srs = await loadSrs()
    const { after } = srs.review('c', newSrsFields(NOW), 3, NOW)
    expect(after.state).toBe(CardState.Learning)
    expect(after.due).toBe(NOW + 10 * 60_000)
    expect(after.reps).toBe(1)
    expect(after.last_review).toBe(NOW)
    expect(dueWithinSession(after, NOW)).toBe(true)
  })

  it('Good on a review card moves due forward by the scheduled interval (fuzz off: exact)', async () => {
    const srs = await loadSrs({ enableFuzz: false })
    const { after, elapsedDays } = srs.review('c', reviewCard(), 3, NOW)
    expect(elapsedDays).toBe(10)
    expect(after.state).toBe(CardState.Review)
    expect(after.scheduled_days).toBeGreaterThan(10) // recalled after 10 days: the interval grows
    expect(after.due).toBe(NOW + after.scheduled_days * DAY)
    expect(after.stability).toBeGreaterThan(10)
    expect(dueWithinSession(after, NOW)).toBe(false)
  })

  it('fuzz stays close to the unfuzzed interval and is deterministic per card', async () => {
    const plain = await loadSrs({ enableFuzz: false })
    const fuzzed = await loadSrs()
    const base = plain.review('c', reviewCard(), 3, NOW).after.scheduled_days
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      const a = fuzzed.review(id, reviewCard(), 3, NOW).after
      const b = fuzzed.review(id, reviewCard(), 3, NOW).after
      expect(a).toEqual(b) // same card id + state + time -> same result (client preview = server)
      expect(Math.abs(a.scheduled_days - base)).toBeLessThanOrEqual(Math.max(2, Math.ceil(base * 0.15)))
      expect(a.due).toBe(NOW + a.scheduled_days * DAY)
    }
  })

  it('caps intervals at 365 days', async () => {
    const srs = await loadSrs()
    const strong = { ...reviewCard(), stability: 2000, scheduled_days: 300, last_review: NOW - 300 * DAY }
    expect(srs.review('c', strong, 4, NOW).after.scheduled_days).toBeLessThanOrEqual(365)
  })

  it('Again on a review card relearns with the 10m step and counts a lapse', async () => {
    const srs = await loadSrs()
    const { after } = srs.review('c', reviewCard(), 1, NOW)
    expect(after.state).toBe(CardState.Relearning)
    expect(after.due).toBe(NOW + 10 * 60_000)
    expect(after.lapses).toBe(1)
  })

  it('previewIntervals labels the four buttons and does not change the card', async () => {
    const srs = await loadSrs()
    const card = newSrsFields(NOW)
    const labels = previewIntervals(srs, 'c', card, NOW)
    expect(labels[1]).toBe('1m')
    expect(labels[3]).toBe('10m')
    expect(labels[4]).toMatch(/^\d+d$/)
    expect(card).toEqual(newSrsFields(NOW))
    const review = previewIntervals(srs, 'c', reviewCard(), NOW)
    expect(review[1]).toBe('10m')
    for (const g of [2, 3, 4] as const) expect(review[g]).toMatch(/^\d+(d|mo)$/)
  })
})

describe('formatInterval', () => {
  it.each([
    [30_000, '<1m'],
    [60_000, '1m'],
    [10 * 60_000, '10m'],
    [3 * 3_600_000, '3h'],
    [3 * DAY, '3d'],
    [29 * DAY, '29d'],
    [60 * DAY, '2mo'],
    [365 * DAY, '1y'],
  ])('%i ms -> %s', (ms, label) => {
    expect(formatInterval(ms)).toBe(label)
  })
})
