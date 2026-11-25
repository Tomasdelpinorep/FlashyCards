import { describe, expect, it } from 'vitest'
import { speechErrorMessage, speechServiceMissing } from '../../src/client/lib/speechErrors'

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

describe('speechServiceMissing', () => {
  it('Chrome and Edge have the speech service', () => {
    expect(speechServiceMissing({ userAgent: CHROME_UA, userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] } })).toBe(false)
    expect(speechServiceMissing({ userAgent: `${CHROME_UA} Edg/131.0`, userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }] } })).toBe(false)
    expect(speechServiceMissing({ userAgent: CHROME_UA })).toBe(false)
  })
  it('Opera, Brave and other Chromium browsers do not', () => {
    expect(speechServiceMissing({ userAgent: `${CHROME_UA} OPR/114.0` })).toBe(true)
    expect(speechServiceMissing({ userAgent: CHROME_UA, userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Opera GX' }] } })).toBe(true)
    expect(speechServiceMissing({ userAgent: CHROME_UA, brave: {} })).toBe(true)
    expect(speechServiceMissing({ userAgent: CHROME_UA, userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Not A Brand' }] } })).toBe(true)
  })
})

describe('speechErrorMessage', () => {
  it('maps every code, and says nothing for aborted', () => {
    expect(speechErrorMessage('aborted', 'German', false)).toBeNull()
    expect(speechErrorMessage('network', 'German', false)?.text).toBe('Speech service unreachable — check your connection or VPN')
    expect(speechErrorMessage('audio-capture', 'German', false)?.text).toBe('No microphone found')
    expect(speechErrorMessage('language-not-supported', 'German', false)?.text).toBe('Your browser can’t recognise German')
    expect(speechErrorMessage('bad-grammar', 'German', false)?.text).toBe('Speech recognition failed (bad-grammar)')
  })
  it('a browser without the service says so; a real refusal in Chrome stays "blocked"', () => {
    expect(speechErrorMessage('network', 'German', true)).toEqual({ text: 'Voice input needs Chrome or Edge', blocked: true })
    expect(speechErrorMessage('service-not-allowed', 'German', true)?.text).toBe('Voice input needs Chrome or Edge')
    expect(speechErrorMessage('not-allowed', 'German', false)).toEqual({ text: 'Microphone blocked — allow it in the browser settings', blocked: true })
  })
})
