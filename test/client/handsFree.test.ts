import { describe, expect, it } from 'vitest'
import { createSwitch, MIC_MAX_EMPTY, micAfterEnd, shouldAutoAdvance } from '../../src/client/lib/handsFree'

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  } as unknown as Storage & { data: Map<string, string> }
}

describe('createSwitch', () => {
  it('is off by default, persists and notifies', () => {
    const store = memory()
    const s = createSwitch('k', () => store)
    expect(s.get()).toBe(false)
    let calls = 0
    const off = s.subscribe(() => calls++)
    s.set(true)
    s.set(true)
    expect(s.get()).toBe(true)
    expect(store.data.get('k')).toBe('1')
    expect(calls).toBe(1)
    off()
    s.set(false)
    expect(calls).toBe(1)
    expect(store.data.get('k')).toBe('0')
  })
  it('reads the stored value (a reload)', () => {
    const store = memory()
    store.data.set('k', '1')
    expect(createSwitch('k', () => store).get()).toBe(true)
  })
  it('survives storage that throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const s = createSwitch('k', () => bad)
    expect(s.get()).toBe(false)
    s.set(true)
    expect(s.get()).toBe(true)
    expect(createSwitch('k', () => null).get()).toBe(false)
  })
})

describe('micAfterEnd', () => {
  it('listens again until MIC_MAX_EMPTY empty results in a row, then pauses', () => {
    let streak = 0
    for (let i = 1; i < MIC_MAX_EMPTY; i++) {
      const r = micAfterEnd(streak, false)
      expect(r).toEqual({ streak: i, action: 'retry' })
      streak = r.streak
    }
    expect(micAfterEnd(streak, false)).toEqual({ streak: 0, action: 'pause' })
  })
  it('a transcript resets the count', () => {
    expect(micAfterEnd(MIC_MAX_EMPTY - 1, true)).toEqual({ streak: 0, action: 'retry' })
  })
})

describe('shouldAutoAdvance', () => {
  it('only for a correct answer with Auto on and grading ready', () => {
    expect(shouldAutoAdvance(true, 'correct', true)).toBe(true)
    expect(shouldAutoAdvance(false, 'correct', true)).toBe(false)
    expect(shouldAutoAdvance(true, 'correct', false)).toBe(false)
    for (const v of ['typo', 'wrong', 'missing-article', 'wrong-article'] as const) expect(shouldAutoAdvance(true, v, true)).toBe(false)
    expect(shouldAutoAdvance(true, null, true)).toBe(false)
  })
})
