import { describe, expect, it } from 'vitest'
import {
  alreadyKnow,
  clearResume,
  gotIt,
  gradeCheck,
  learnStep,
  loadResume,
  remainingCount,
  resumeLearn,
  saveResume,
  startLearn,
  type LearnSession,
} from '../../src/client/lib/learnSession'
import type { CardDTO } from '../../src/shared/schemas'
import { CardState, loadSrs, newSrsFields, type Grade, type Srs, type SrsFields } from '../../src/shared/srs'

const NOW = Date.UTC(2026, 10, 21, 12)
const MIN = 60_000

function card(id: string, srs: SrsFields = newSrsFields(NOW)): CardDTO {
  return {
    id,
    deckId: 'd',
    status: 'ready',
    display: id,
    inputTerm: id,
    inputHint: null,
    inputLang: 'target',
    translation: null,
    extraTranslations: [],
    content: null,
    note: null,
    genError: null,
    state: srs.state,
    due: srs.due,
    srs,
    createdAt: 0,
  }
}

const cards = (n: number) => Array.from({ length: n }, (_, i) => card(`c${i + 1}`))

/** Grade the card on screen as a real session would (local FSRS result). */
function grade(srs: Srs, s: LearnSession, g: Grade, now: number): LearnSession {
  const step = learnStep(s, now)
  if (step.kind !== 'check') throw new Error(`expected a check card, got ${step.kind}`)
  const { after } = srs.review(step.card.id, step.card.srs, g, now)
  return gradeCheck(s, step.card, g, after, now)
}

function introId(s: LearnSession, now: number): string {
  const step = learnStep(s, now)
  if (step.kind !== 'intro') throw new Error(`expected an intro card, got ${step.kind}`)
  return step.card.id
}

describe('Learn session: intro -> quick check -> requeue', () => {
  it('introduces a group of 5, then checks the "got it" cards; "already know" leaves the session', () => {
    let s = startLearn(cards(7), { now: NOW })
    expect(s.intro.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(s.upcoming.map((c) => c.id)).toEqual(['c6', 'c7'])

    for (const id of ['c1', 'c2']) {
      expect(introId(s, NOW)).toBe(id)
      s = gotIt(s, id, NOW)
    }
    s = alreadyKnow(s, introId(s, NOW), NOW) // c3
    s = gotIt(s, introId(s, NOW), NOW) // c4
    s = alreadyKnow(s, introId(s, NOW), NOW) // c5
    expect(s.alreadyKnew).toBe(2)
    expect(learnStep(s, NOW)).toMatchObject({ kind: 'check', card: { id: 'c1' } })
    expect(s.check.queue.map((c) => c.id)).toEqual(['c1', 'c2', 'c4'])
    expect(remainingCount(s)).toBe(5) // 3 to check + 2 upcoming
  })

  it('requeues learning steps until they graduate, then moves on to the next group and ends', async () => {
    const srs = await loadSrs({ enableFuzz: false })
    let s = startLearn(cards(6), { now: NOW })
    let t = NOW
    for (let i = 0; i < 5; i++) s = gotIt(s, introId(s, t), t)

    // First pass: Good puts each card on the 10-minute step.
    for (let i = 0; i < 5; i++) s = grade(srs, s, 3, t)
    expect(s.check.again.map((c) => [c.id, c.srs.state])).toEqual(
      ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => [id, CardState.Learning]),
    )
    expect(s.learned).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    // Nothing due right now -> the next group starts (c6) before the requeued cards come back.
    expect(introId(s, t)).toBe('c6')
    s = gotIt(s, 'c6', t)
    s = grade(srs, s, 1, t) // c6: Again -> 1-minute step
    expect(s.check.again.find((c) => c.id === 'c6')?.srs.due).toBe(t + MIN)

    // No more groups: requeued cards come back (early, within the learn-ahead), soonest first.
    expect(learnStep(s, t)).toMatchObject({ kind: 'check', card: { id: 'c6' } })
    t += MIN
    s = grade(srs, s, 3, t) // c6 -> 10-minute step
    t += 10 * MIN
    for (let i = 0; i < 6; i++) s = grade(srs, s, 3, t) // everything graduates
    expect(s.check.again).toEqual([])
    expect(learnStep(s, t)).toEqual({ kind: 'done' })
    expect(s).toMatchObject({ alreadyKnew: 0 })
    expect(s.learned).toHaveLength(6)
    expect(s.check.reviewed).toBe(13)
  })

  it('a requeued card that comes due goes before the next group check cards', async () => {
    const srs = await loadSrs({ enableFuzz: false })
    let s = startLearn(cards(10), { now: NOW })
    for (let i = 0; i < 5; i++) s = gotIt(s, introId(s, NOW), NOW)
    s = grade(srs, s, 1, NOW) // c1: Again, back in 1 minute
    for (let i = 0; i < 4; i++) s = grade(srs, s, 4, NOW) // c2..c5 Easy: graduated
    // c1 is not due yet: group 2 starts.
    expect(introId(s, NOW)).toBe('c6')
    const later = NOW + 2 * MIN
    for (let i = 0; i < 5; i++) s = gotIt(s, introId(s, later), later)
    expect(learnStep(s, later)).toMatchObject({ kind: 'check', card: { id: 'c1' } })
  })

  it('a group where every card is already known goes straight to the next group, then done', () => {
    let s = startLearn(cards(6), { now: NOW })
    for (let i = 0; i < 5; i++) s = alreadyKnow(s, introId(s, NOW), NOW)
    expect(introId(s, NOW)).toBe('c6')
    s = alreadyKnow(s, 'c6', NOW)
    expect(learnStep(s, NOW)).toEqual({ kind: 'done' })
    expect(s.alreadyKnew).toBe(6)
  })

  it('an empty page is done at once', () => {
    expect(learnStep(startLearn([], { now: NOW }), NOW)).toEqual({ kind: 'done' })
  })
})

describe('Learn session: resume after a reload', () => {
  function memoryStore() {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  }

  it('continues learning steps from /review, skips cards with an unsent review, and keeps the counters', async () => {
    const srs = await loadSrs({ enableFuzz: false })
    let s = startLearn(cards(3), { now: NOW })
    s = gotIt(s, 'c1', NOW)
    s = alreadyKnow(s, 'c2', NOW)
    s = gotIt(s, 'c3', NOW)
    s = grade(srs, s, 3, NOW) // c1 -> 10-minute step
    const store = memoryStore()
    saveResume(store, 'd', s, NOW)

    // Reload: the server says c1 is Learning (due in 10 min), c3 is still New, c2 has an Easy
    // review still in the outbox (offline) so the server still lists it as New.
    const resume = loadResume(store, 'd', NOW + MIN)
    expect(resume).toMatchObject({ touched: ['c1'], learned: ['c1'], alreadyKnew: 1 })
    const c1 = card('c1', srs.review('c1', newSrsFields(NOW), 3, NOW).after)
    const other = card('x', { ...newSrsFields(NOW), state: CardState.Learning, due: NOW + 5 * MIN })
    const r = resumeLearn([card('c2'), card('c3')], [c1, other], resume, new Set(['c2']), NOW + MIN)
    expect(r.intro.map((c) => c.id)).toEqual(['c3'])
    expect(r.check.again.map((c) => c.id)).toEqual(['c1']) // not "x": another session's card
    expect(r).toMatchObject({ learned: ['c1'], alreadyKnew: 1 })
  })

  it('ignores a record for another deck or an old one; clearResume forgets it', () => {
    const store = memoryStore()
    saveResume(store, 'd', startLearn(cards(1), { now: NOW }), NOW)
    expect(loadResume(store, 'other', NOW)).toBeNull()
    expect(loadResume(store, 'd', NOW + 7 * 3_600_000)).toBeNull()
    expect(loadResume(store, 'd', NOW)).not.toBeNull()
    clearResume(store)
    expect(loadResume(store, 'd', NOW)).toBeNull()
    expect(loadResume(null, 'd', NOW)).toBeNull()
  })
})
