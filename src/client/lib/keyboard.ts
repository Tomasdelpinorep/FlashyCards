/**
 * The on-screen keyboard (docs/DECISIONS.md "Typing on a phone"). While it is open, the study
 * screens (Screen `fill`) shrink to the part of the screen above it and hide what isn't needed
 * for typing, so the word stays visible right above the answer box.
 *
 * Browsers don't report the keyboard directly. With `interactive-widget=resizes-content`
 * (index.html) Chrome on Android shrinks the page; Safari on iOS keeps the page size and moves
 * the visible area (window.visualViewport) instead. Both shrink visualViewport.height, so: the
 * keyboard is open when a text field has focus and the visible height is well under the tallest
 * height seen at this width (a rotation starts over).
 */
import { useSyncExternalStore } from 'react'
import { CLOSED, keyboardState, type KeyboardState } from './keyboardState'

export type { KeyboardState }

let state: KeyboardState = CLOSED
let tallest = 0
let width = 0
const listeners = new Set<() => void>()

/** Whether `el` brings up a text keyboard. */
export function isTextField(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return !el.readOnly
  if (el instanceof HTMLInputElement) return !el.readOnly && !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color'].includes(el.type)
  return el instanceof HTMLElement && el.isContentEditable
}

function measure() {
  const vv = window.visualViewport
  if (window.innerWidth !== width) {
    width = window.innerWidth
    tallest = 0
  }
  const height = vv?.height ?? window.innerHeight
  tallest = Math.max(tallest, height, window.innerHeight)
  const next = keyboardState({
    focused: isTextField(document.activeElement),
    top: vv?.offsetTop ?? 0,
    height,
    tallest,
    scale: vv?.scale ?? 1,
  })
  if (next.open !== state.open || next.top !== state.top || next.height !== state.height) {
    state = next
    for (const l of listeners) l()
  }
}

let started = false
function start() {
  if (started || typeof window === 'undefined') return
  started = true
  const later = () => requestAnimationFrame(measure)
  window.visualViewport?.addEventListener('resize', measure)
  window.visualViewport?.addEventListener('scroll', measure)
  window.addEventListener('resize', measure)
  // Focus changes before the keyboard animates; measure again once it has moved.
  document.addEventListener('focusin', later)
  document.addEventListener('focusout', later)
  measure()
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(subscribe, () => state, () => CLOSED)
}
