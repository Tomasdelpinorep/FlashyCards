/**
 * Hands-free study: the mic switch (AnswerInput, Train and the Learn quick check) and Auto mode
 * (Train only). Both are per-device switches in localStorage that outlive the card (and the
 * page); every storage access may throw (blocked site data, private mode) and then the switch
 * just isn't remembered.
 */
import { useSyncExternalStore } from 'react'
import type { CheckResult } from '../../shared/answerCheck'
import type { UiLanguage } from '../../shared/languages'

export const MIC_STORAGE_KEY = 'flashy.micOn.v1'
export const AUTO_STORAGE_KEY = 'flashy.autoMode.v1'

/** How long a correct card stays revealed in Auto mode before moving on by itself. */
export const AUTO_ADVANCE_MS = 1000
/** Consecutive recognitions that heard nothing before the mic switch turns itself off. */
export const MIC_MAX_EMPTY = 3
export const MIC_PAUSED = 'Mic paused — tap to resume'
/** MIC_PAUSED in each app language. */
export const MIC_PAUSED_TEXT: Readonly<Record<UiLanguage, string>> = { en: MIC_PAUSED, es: 'Micrófono en pausa: tócalo para seguir' }

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export type Switch = {
  get(): boolean
  set(on: boolean): void
  subscribe(fn: () => void): () => void
}

/** An on/off switch persisted under `key` ('1' / '0'); off when nothing (readable) is stored. */
export function createSwitch(key: string, storage: () => StorageLike | null = defaultStorage): Switch {
  let value: boolean | null = null
  const listeners = new Set<() => void>()
  const read = (): boolean => {
    try {
      return storage()?.getItem(key) === '1'
    } catch {
      return false
    }
  }
  return {
    get() {
      value ??= read()
      return value
    },
    set(on) {
      if (value === on) return
      value = on
      try {
        storage()?.setItem(key, on ? '1' : '0')
      } catch {
        // not remembered; the switch still works for this page
      }
      for (const fn of listeners) fn()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export const micSwitch = createSwitch(MIC_STORAGE_KEY)
export const autoSwitch = createSwitch(AUTO_STORAGE_KEY)

export function useSwitch(s: Switch): boolean {
  return useSyncExternalStore(s.subscribe, s.get, () => false)
}

/**
 * After a recognition ended on a still unanswered card: listen again, or pause the mic after
 * MIC_MAX_EMPTY empty ones in a row. `heard`: it produced a transcript (resets the count).
 */
export function micAfterEnd(emptyStreak: number, heard: boolean): { streak: number; action: 'retry' | 'pause' } {
  const streak = heard ? 0 : emptyStreak + 1
  return streak >= MIC_MAX_EMPTY ? { streak: 0, action: 'pause' } : { streak, action: 'retry' }
}

/** Auto mode moves on by itself only after a correct answer (a wrong one needs reading). */
export function shouldAutoAdvance(auto: boolean, verdict: CheckResult['verdict'] | null, canGrade: boolean): boolean {
  return auto && canGrade && verdict === 'correct'
}
