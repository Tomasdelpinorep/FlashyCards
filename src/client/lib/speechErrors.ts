/** Speech recognition error messages and browser detection (pure; used by lib/speech.ts). */

/**
 * Chromium browsers other than Chrome and Edge (Opera, Brave, Vivaldi, ...) expose the recognizer
 * but have no speech service behind it: it fails with 'network' or 'service-not-allowed'.
 */
export function speechServiceMissing(nav: {
  userAgent: string
  userAgentData?: { brands?: readonly { brand: string }[] }
  brave?: unknown
}): boolean {
  if (nav.brave) return true
  const ua = nav.userAgent
  const brands = nav.userAgentData?.brands?.map((b) => b.brand) ?? []
  if (brands.some((b) => /opera|brave|vivaldi|yandex/i.test(b)) || /OPR\/|Opera|Vivaldi|YaBrowser/.test(ua)) return true
  if (brands.length > 0) return brands.includes('Chromium') && !brands.includes('Google Chrome') && !brands.includes('Microsoft Edge')
  return false
}

/**
 * What to tell the learner about a recognition error code, or null for none ('aborted': we
 * stopped it). `blocked` marks a refused microphone (the mic then stays off).
 */
export function speechErrorMessage(code: string, langName: string, serviceMissing: boolean): { text: string; blocked: boolean } | null {
  switch (code) {
    case 'aborted':
      return null
    case 'no-speech':
      return { text: 'Didn’t catch that — try again', blocked: false }
    case 'network':
      return serviceMissing
        ? { text: 'Voice input needs Chrome or Edge', blocked: true }
        : { text: 'Speech service unreachable — check your connection or VPN', blocked: false }
    case 'service-not-allowed':
      return serviceMissing ? { text: 'Voice input needs Chrome or Edge', blocked: true } : { text: 'Microphone blocked — allow it in the browser settings', blocked: true }
    case 'not-allowed':
      return { text: serviceMissing ? 'Microphone blocked — allow it, or use Chrome or Edge' : 'Microphone blocked — allow it in the browser settings', blocked: true }
    case 'audio-capture':
      return { text: 'No microphone found', blocked: false }
    case 'language-not-supported':
      return { text: `Your browser can’t recognise ${langName}`, blocked: false }
    default:
      return { text: `Speech recognition failed (${code || 'unknown'})`, blocked: false }
  }
}
