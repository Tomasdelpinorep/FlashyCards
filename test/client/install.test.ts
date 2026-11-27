import { describe, expect, it } from 'vitest'
import { installView, isIos } from '../../src/client/lib/installState'

const base = { standalone: false, canPrompt: false, installed: false, ios: false }

describe('installView', () => {
  it('shows the button while the browser offers to install', () => {
    expect(installView({ ...base, canPrompt: true })).toBe('button')
  })
  it('hides it inside the installed app and right after installing', () => {
    expect(installView({ ...base, canPrompt: true, standalone: true })).toBe('hidden')
    expect(installView({ ...base, installed: true })).toBe('hidden')
  })
  it('hides it when the browser offers nothing (already installed, or unsupported)', () => {
    expect(installView(base)).toBe('hidden')
  })
  it('explains Add to Home Screen on iOS, except inside the installed app', () => {
    expect(installView({ ...base, ios: true })).toBe('ios-hint')
    expect(installView({ ...base, ios: true, standalone: true })).toBe('hidden')
  })
})

describe('isIos', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 0, true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 5, true], // iPadOS
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 0, false], // a Mac
    ['Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 5, false],
  ])('%s -> %s', (ua, touch, ios) => {
    expect(isIos(ua, touch)).toBe(ios)
  })
})
