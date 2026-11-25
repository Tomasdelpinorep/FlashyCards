/**
 * Automatic grading from answer time (docs/DECISIONS.md, "Grading from answer time"). Pure and
 * unit-tested; the client measures the times and keeps the per-device calibration
 * (src/client/lib/answerTiming.ts).
 *
 * - thinkMs: card shown -> first keystroke (or speech start); typeMs: first input -> correct.
 * - par: difficulty points of the expected answer * the learner's seconds per point.
 * - grade: wrong Again, typo Hard, slow Hard, fast Easy (strict), else Good.
 */
import { isLanguageCode, LANGUAGES } from './languages'
import type { Verdict } from './answerCheck'
import type { Grade } from './srs'

/** Each measured interval is capped here (a card left open is not "slow typing"). */
export const TIMING_CAP_MS = 60_000

/** Hard when thinking took longer than max(HARD_THINK_MIN_MS, HARD_THINK_FACTOR * typical). */
export const HARD_THINK_MIN_MS = 8000
export const HARD_THINK_FACTOR = 2.5
/** Hard when typing took longer than HARD_TYPE_FACTOR * par. */
export const HARD_TYPE_FACTOR = 2
/** Easy needs thinking within max(EASY_THINK_MIN_MS, EASY_THINK_FACTOR * typical) and typing within par. */
export const EASY_THINK_MIN_MS = 1500
export const EASY_THINK_FACTOR = 0.6

export type InputKind = 'keyboard' | 'touch'

export const DEFAULT_SEC_PER_POINT: Record<InputKind, number> = { keyboard: 0.35, touch: 0.6 }
export const DEFAULT_THINK_MS = 2500
/** Samples before the calibration stops blending in the defaults. */
export const CALIBRATION_MIN_SAMPLES = 5
/** Weight of a new sample in the moving averages. */
export const CALIBRATION_ALPHA = 0.2
/** A sample more than this factor off the current estimate (either way) is an outlier. */
export const OUTLIER_FACTOR = 4

/**
 * Difficulty points of an answer as typed: 1 per letter, +2 per letter outside plain a-z (the
 * language's answerFolds, e.g. ä ö ü ß, or any other non a-z letter), +1 per space or hyphen,
 * +2 if an article is required.
 */
export function answerPoints(text: string, lang: string, articleRequired: boolean): number {
  const folds = new Set((isLanguageCode(lang) ? LANGUAGES[lang].answerFolds : []).map(([from]) => from))
  let points = articleRequired ? 2 : 0
  for (const ch of text.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ')) {
    if (ch === ' ' || ch === '-') points += 1
    else if (/\p{L}/u.test(ch)) points += folds.has(ch) || !/[a-z]/.test(ch) ? 3 : 1
  }
  return points
}

/** The expected typing time in ms. */
export function typeParMs(points: number, secPerPoint: number): number {
  return points * secPerPoint * 1000
}

export type Timing = {
  thinkMs: number
  /** null for a spoken answer (no typing component). */
  typeMs: number | null
  /** Either interval hit TIMING_CAP_MS. */
  capped: boolean
}

export function capTiming(thinkMs: number, typeMs: number | null): Timing {
  const c = (ms: number) => Math.min(Math.max(0, ms), TIMING_CAP_MS)
  const capped = thinkMs >= TIMING_CAP_MS || (typeMs !== null && typeMs >= TIMING_CAP_MS)
  return { thinkMs: c(thinkMs), typeMs: typeMs === null ? null : c(typeMs), capped }
}

/**
 * The automatic grade. `verdict` null means "Show answer" without a right answer.
 * typicalThinkMs and typeParMs come from the learner's calibration.
 */
export function gradeFromTiming(a: {
  verdict: Verdict | null
  timing: Timing | null
  typicalThinkMs: number
  typeParMs: number
}): Grade {
  if (a.verdict === 'typo') return 2
  if (a.verdict !== 'correct') return 1
  if (!a.timing) return 3
  const { thinkMs, typeMs } = a.timing
  if (thinkMs > Math.max(HARD_THINK_MIN_MS, HARD_THINK_FACTOR * a.typicalThinkMs)) return 2
  if (typeMs !== null && typeMs > HARD_TYPE_FACTOR * a.typeParMs) return 2
  if (thinkMs <= Math.max(EASY_THINK_MIN_MS, EASY_THINK_FACTOR * a.typicalThinkMs) && (typeMs === null || typeMs <= a.typeParMs)) return 4
  return 3
}

// ---------- per-device calibration ----------

export type Calibration = {
  /** Moving averages (null before the first sample) and their sample counts. */
  secPerPoint: number | null
  typeSamples: number
  thinkMs: number | null
  thinkSamples: number
}

export const EMPTY_CALIBRATION: Calibration = { secPerPoint: null, typeSamples: 0, thinkMs: null, thinkSamples: 0 }

function blend(avg: number | null, samples: number, fallback: number): number {
  if (avg === null || samples <= 0) return fallback
  const w = Math.min(samples, CALIBRATION_MIN_SAMPLES) / CALIBRATION_MIN_SAMPLES
  return w * avg + (1 - w) * fallback
}

/** The values to grade with: the averages, with the defaults blended in before enough samples. */
export function effectiveCalibration(c: Calibration, kind: InputKind): { secPerPoint: number; thinkMs: number } {
  return {
    secPerPoint: blend(c.secPerPoint, c.typeSamples, DEFAULT_SEC_PER_POINT[kind]),
    thinkMs: blend(c.thinkMs, c.thinkSamples, DEFAULT_THINK_MS),
  }
}

function ema(avg: number | null, sample: number): number {
  return avg === null ? sample : avg + CALIBRATION_ALPHA * (sample - avg)
}

function outlier(sample: number, estimate: number): boolean {
  return sample > estimate * OUTLIER_FACTOR || sample < estimate / OUTLIER_FACTOR
}

/** Learn from one answer: only correct, uncapped, non-outlier answers count; typing only when typed. */
export function updateCalibration(c: Calibration, kind: InputKind, a: { verdict: Verdict | null; timing: Timing | null; points: number }): Calibration {
  if (a.verdict !== 'correct' || !a.timing || a.timing.capped) return c
  const eff = effectiveCalibration(c, kind)
  const next = { ...c }
  const think = a.timing.thinkMs
  if (think > 0 && !outlier(think, eff.thinkMs)) {
    next.thinkMs = ema(c.thinkMs, think)
    next.thinkSamples = c.thinkSamples + 1
  }
  if (a.timing.typeMs !== null && a.timing.typeMs > 0 && a.points > 0) {
    const spp = a.timing.typeMs / 1000 / a.points
    if (!outlier(spp, eff.secPerPoint)) {
      next.secPerPoint = ema(c.secPerPoint, spp)
      next.typeSamples = c.typeSamples + 1
    }
  }
  return next
}

/** Reads a stored calibration defensively (anything malformed falls back to empty). */
export function parseCalibration(v: unknown): Calibration {
  if (!v || typeof v !== 'object') return EMPTY_CALIBRATION
  const o = v as Record<string, unknown>
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null)
  const count = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0)
  const secPerPoint = num(o.secPerPoint)
  const thinkMs = num(o.thinkMs)
  return {
    secPerPoint,
    typeSamples: secPerPoint === null ? 0 : count(o.typeSamples),
    thinkMs,
    thinkSamples: thinkMs === null ? 0 : count(o.thinkSamples),
  }
}

/** "2.1 s" */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}
