/**
 * Client side of grading from answer time (src/shared/answerTiming.ts): the clock, the input
 * kind, and the per-device calibration in localStorage (every access may throw: blocked site
 * data, private mode; it then falls back to the defaults).
 */
import { EMPTY_CALIBRATION, parseCalibration, type Calibration, type InputKind } from '../../shared/answerTiming'

const STORAGE_KEY = 'flashy.answerTiming.v1'

/**
 * Milliseconds from a monotonic clock. A test may inject its own (window.__answerClock), so the
 * e2e suite can make answers "fast" or "slow" deterministically.
 */
export function answerNow(): number {
  const injected = (globalThis as { __answerClock?: () => number }).__answerClock
  if (typeof injected === 'function') return injected()
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** touch (pointer: coarse) or keyboard: typing speeds differ a lot, so they are calibrated apart. */
export function inputKind(): InputKind {
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard'
  } catch {
    return 'keyboard'
  }
}

function readAll(): Partial<Record<InputKind, unknown>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    return v && typeof v === 'object' ? (v as Partial<Record<InputKind, unknown>>) : {}
  } catch {
    return {}
  }
}

export function loadCalibration(kind: InputKind): Calibration {
  try {
    return parseCalibration(readAll()[kind])
  } catch {
    return EMPTY_CALIBRATION
  }
}

export function saveCalibration(kind: InputKind, c: Calibration): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [kind]: c }))
  } catch {
    // not stored: the defaults keep working
  }
}

/**
 * A stopwatch that does not run while the page is hidden (another tab, the phone locked).
 * elapsed() is the visible time since start.
 */
export class VisibleClock {
  private start = answerNow()
  private hiddenTotal = 0
  private hiddenSince: number | null = null
  private readonly onVisibility = () => {
    if (document.hidden) this.hiddenSince ??= answerNow()
    else if (this.hiddenSince !== null) {
      this.hiddenTotal += answerNow() - this.hiddenSince
      this.hiddenSince = null
    }
  }

  constructor() {
    if (typeof document !== 'undefined') {
      if (document.hidden) this.hiddenSince = this.start
      document.addEventListener('visibilitychange', this.onVisibility)
    }
  }

  elapsed(): number {
    const t = answerNow()
    const hidden = this.hiddenTotal + (this.hiddenSince !== null ? t - this.hiddenSince : 0)
    return t - this.start - hidden
  }

  dispose(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
  }
}
