import { describe, expect, it } from 'vitest'
import { bannerProgress, IDLE, shouldResume, startState } from '../../src/client/lib/generationState'
import type { DuplicateReport } from '../../src/shared/schemas'

const dup: DuplicateReport = {
  input: 'dog',
  reason: 'resolved',
  existing: { id: 'c1', display: 'der Hund', status: 'ready' },
  addedTranslation: null,
}

describe('bannerProgress (e2e bug: no banner until the first /generate call returned)', () => {
  it('shows 0/pending while the first call of a run is in flight', () => {
    expect(bannerProgress({ ...IDLE, running: true }, 3)).toEqual({ done: 0, total: 3 })
  })
  it("uses the loop's own counts once it has them", () => {
    expect(bannerProgress({ ...IDLE, running: true, done: 10, total: 25 }, 15)).toEqual({ done: 10, total: 25 })
  })
  it('shows nothing when idle or when nothing is pending yet', () => {
    expect(bannerProgress(IDLE, 3)).toBeNull()
    expect(bannerProgress({ ...IDLE, running: true }, 0)).toBeNull()
  })
})

describe('resuming the loop (e2e bug: a stale stats response restarted it and wiped its duplicates)', () => {
  const base = { pending: 2, running: false, limited: false, error: null, statsUpdatedAt: 2000, lastRunEndedAt: 1000 }

  it('resumes when fresh stats show pending cards', () => {
    expect(shouldResume(base)).toBe(true)
  })
  it('ignores stats fetched before the last run ended', () => {
    expect(shouldResume({ ...base, statsUpdatedAt: 900 })).toBe(false)
    expect(shouldResume({ ...base, statsUpdatedAt: 1000 })).toBe(false)
  })
  it('never resumes while running, rate limited, after an error, or with nothing pending', () => {
    expect(shouldResume({ ...base, running: true })).toBe(false)
    expect(shouldResume({ ...base, limited: true })).toBe(false)
    expect(shouldResume({ ...base, error: 'boom' })).toBe(false)
    expect(shouldResume({ ...base, pending: 0 })).toBe(false)
  })
  it('an automatic resume keeps the duplicates found so far; a fresh start clears them', () => {
    const prev = { ...IDLE, done: 2, total: 2, duplicates: [dup] }
    expect(startState(prev, false)).toEqual({ ...IDLE, running: true, duplicates: [dup] })
    expect(startState(prev, true)).toEqual({ ...IDLE, running: true, duplicates: [] })
  })
})
