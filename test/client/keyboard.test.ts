import { describe, expect, it } from 'vitest'
import { keyboardState } from '../../src/client/lib/keyboardState'

const base = { focused: true, top: 0, height: 900, tallest: 900, scale: 1 }

describe('keyboardState', () => {
  it('is closed at full height', () => {
    expect(keyboardState(base).open).toBe(false)
  })
  it('is open when a text field has focus and the visible height drops (Android resize)', () => {
    expect(keyboardState({ ...base, height: 480 })).toEqual({ open: true, top: 0, height: 480 })
  })
  it('follows the visible area when the page is panned (iOS)', () => {
    expect(keyboardState({ ...base, height: 520.4, top: 310.6 })).toEqual({ open: true, top: 311, height: 520 })
  })
  it('stays closed without a focused text field (e.g. the browser bar or a split screen)', () => {
    expect(keyboardState({ ...base, focused: false, height: 480 }).open).toBe(false)
  })
  it('stays closed for a small change (address bar showing or hiding)', () => {
    expect(keyboardState({ ...base, height: 820 }).open).toBe(false)
  })
  it('stays closed while pinch-zoomed', () => {
    expect(keyboardState({ ...base, height: 450, scale: 2 }).open).toBe(false)
  })
})
