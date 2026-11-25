import { describe, expect, it } from 'vitest'
import {
  answerPoints,
  CALIBRATION_MIN_SAMPLES,
  capTiming,
  DEFAULT_SEC_PER_POINT,
  DEFAULT_THINK_MS,
  effectiveCalibration,
  EMPTY_CALIBRATION,
  formatSeconds,
  gradeFromTiming,
  parseCalibration,
  TIMING_CAP_MS,
  typeParMs,
  updateCalibration,
  type Calibration,
} from '../../src/shared/answerTiming'

describe('answerPoints', () => {
  it('counts letters, special letters, spaces and the article', () => {
    expect(answerPoints('dog', 'en', false)).toBe(3)
    expect(answerPoints('der Hund', 'de', true)).toBe(3 + 1 + 4 + 2)
    expect(answerPoints('Mädchen', 'de', false)).toBe(7 + 2)
    expect(answerPoints('Straße', 'de', false)).toBe(6 + 2)
    expect(answerPoints('E-Mail', 'de', false)).toBe(5 + 1)
    expect(answerPoints('canción', 'es', false)).toBe(7 + 2)
    expect(answerPoints('  ice   cream! ', 'en', false)).toBe(8 + 1)
  })
  it('scales the par by seconds per point', () => {
    expect(typeParMs(10, 0.35)).toBeCloseTo(3500)
  })
})

describe('capTiming', () => {
  it('caps each interval and flags it', () => {
    expect(capTiming(1000, 2000)).toEqual({ thinkMs: 1000, typeMs: 2000, capped: false })
    expect(capTiming(90_000, 2000)).toEqual({ thinkMs: TIMING_CAP_MS, typeMs: 2000, capped: true })
    expect(capTiming(1000, null)).toEqual({ thinkMs: 1000, typeMs: null, capped: false })
  })
})

describe('gradeFromTiming', () => {
  const base = { typicalThinkMs: 2500, typeParMs: 3000 }
  const g = (verdict: Parameters<typeof gradeFromTiming>[0]['verdict'], thinkMs: number, typeMs: number | null) =>
    gradeFromTiming({ ...base, verdict, timing: capTiming(thinkMs, typeMs) })

  it('wrong, article mistakes and Show answer are Again; a typo is Hard', () => {
    expect(g('wrong', 500, 500)).toBe(1)
    expect(g('missing-article', 500, 500)).toBe(1)
    expect(g('wrong-article', 500, 500)).toBe(1)
    expect(gradeFromTiming({ ...base, verdict: null, timing: null })).toBe(1)
    expect(g('typo', 500, 500)).toBe(2)
  })
  it('fast is Easy, usual is Good, slow is Hard', () => {
    expect(g('correct', 1500, 3000)).toBe(4)
    expect(g('correct', 1000, null)).toBe(4) // spoken: no typing part
    expect(g('correct', 1600, 1000)).toBe(3)
    expect(g('correct', 1000, 3100)).toBe(3)
    expect(g('correct', 8000, 1000)).toBe(3)
    expect(g('correct', 8001, 1000)).toBe(2)
    expect(g('correct', 1000, 6001)).toBe(2)
  })
  it('follows a slow thinker', () => {
    const slow = { typicalThinkMs: 5000, typeParMs: 3000 }
    expect(gradeFromTiming({ ...slow, verdict: 'correct', timing: capTiming(3000, 1000) })).toBe(4) // 0.6 * 5000
    expect(gradeFromTiming({ ...slow, verdict: 'correct', timing: capTiming(12_000, 1000) })).toBe(3) // under 2.5 * 5000
    expect(gradeFromTiming({ ...slow, verdict: 'correct', timing: capTiming(12_600, 1000) })).toBe(2)
  })
})

describe('calibration', () => {
  it('starts at the defaults', () => {
    expect(effectiveCalibration(EMPTY_CALIBRATION, 'keyboard')).toEqual({ secPerPoint: DEFAULT_SEC_PER_POINT.keyboard, thinkMs: DEFAULT_THINK_MS })
    expect(effectiveCalibration(EMPTY_CALIBRATION, 'touch').secPerPoint).toBe(DEFAULT_SEC_PER_POINT.touch)
  })
  it('learns from correct answers and blends the defaults in at first', () => {
    const ok = { verdict: 'correct' as const, timing: capTiming(2000, 2000), points: 5 } // 0.4 s per point
    let c: Calibration = updateCalibration(EMPTY_CALIBRATION, 'keyboard', ok)
    expect(c).toMatchObject({ secPerPoint: 0.4, typeSamples: 1, thinkMs: 2000, thinkSamples: 1 })
    const first = effectiveCalibration(c, 'keyboard')
    expect(first.secPerPoint).toBeCloseTo(0.35 + (0.4 - 0.35) / CALIBRATION_MIN_SAMPLES)
    for (let i = 0; i < 10; i++) c = updateCalibration(c, 'keyboard', ok)
    expect(effectiveCalibration(c, 'keyboard').secPerPoint).toBeCloseTo(0.4)
    expect(effectiveCalibration(c, 'keyboard').thinkMs).toBeCloseTo(2000)
  })
  it('ignores wrong, capped, outlier and (for typing) spoken answers', () => {
    const t = (thinkMs: number, typeMs: number | null) => capTiming(thinkMs, typeMs)
    expect(updateCalibration(EMPTY_CALIBRATION, 'keyboard', { verdict: 'typo', timing: t(2000, 2000), points: 5 })).toBe(EMPTY_CALIBRATION)
    expect(updateCalibration(EMPTY_CALIBRATION, 'keyboard', { verdict: 'correct', timing: t(70_000, 2000), points: 5 })).toBe(EMPTY_CALIBRATION)
    expect(updateCalibration(EMPTY_CALIBRATION, 'keyboard', { verdict: 'correct', timing: t(30_000, 30_000), points: 5 })).toEqual(EMPTY_CALIBRATION)
    expect(updateCalibration(EMPTY_CALIBRATION, 'keyboard', { verdict: 'correct', timing: t(2000, null), points: 5 })).toMatchObject({ typeSamples: 0, thinkSamples: 1 })
  })
  it('parses stored values defensively', () => {
    expect(parseCalibration(null)).toEqual(EMPTY_CALIBRATION)
    expect(parseCalibration({ secPerPoint: 'x', thinkMs: -1, typeSamples: 3 })).toEqual(EMPTY_CALIBRATION)
    expect(parseCalibration({ secPerPoint: 0.5, typeSamples: 7, thinkMs: 2000, thinkSamples: 2 })).toEqual({ secPerPoint: 0.5, typeSamples: 7, thinkMs: 2000, thinkSamples: 2 })
  })
  it('formats seconds', () => {
    expect(formatSeconds(2140)).toBe('2.1 s')
  })
})
