/** The pure keyboard rule of lib/keyboard.ts (no DOM, unit-tested). */

export type KeyboardState = {
  open: boolean
  /** The visible area, in CSS pixels from the top of the layout viewport. */
  top: number
  height: number
}

export const CLOSED: KeyboardState = { open: false, top: 0, height: 0 }
/** Open when the visible height drops under this share of the tallest seen (keyboards take ~40%). */
export const OPEN_RATIO = 0.8

/** Pure rule (unit-tested): the keyboard state for these measurements. */
export function keyboardState(m: { focused: boolean; top: number; height: number; tallest: number; scale: number }): KeyboardState {
  // Pinch-zoom also shrinks the visible area: only an unzoomed page counts.
  const open = m.focused && Math.abs(m.scale - 1) < 0.01 && m.height < m.tallest * OPEN_RATIO
  return open ? { open, top: Math.max(0, Math.round(m.top)), height: Math.round(m.height) } : CLOSED
}
