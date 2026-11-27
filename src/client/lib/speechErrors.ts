/** Speech recognition error messages and browser detection (pure; used by lib/speech.ts). */
import type { UiLanguage } from '../../shared/languages'

const TEXT = {
  en: {
    noSpeech: 'Didn’t catch that — try again',
    needsChrome: 'Voice input needs Chrome or Edge',
    unreachable: 'Speech service unreachable — check your connection or VPN',
    blocked: 'Microphone blocked — allow it in the browser settings',
    blockedOrChrome: 'Microphone blocked — allow it, or use Chrome or Edge',
    noMic: 'No microphone found',
    langUnsupported: (lang: string) => `Your browser can’t recognise ${lang}`,
    failed: (code: string) => `Speech recognition failed (${code || 'unknown'})`,
  },
  es: {
    noSpeech: 'No te he entendido: inténtalo otra vez',
    needsChrome: 'La entrada por voz necesita Chrome o Edge',
    unreachable: 'No se puede conectar con el servicio de voz: revisa tu conexión o la VPN',
    blocked: 'Micrófono bloqueado: permítelo en los ajustes del navegador',
    blockedOrChrome: 'Micrófono bloqueado: permítelo o usa Chrome o Edge',
    noMic: 'No se ha encontrado ningún micrófono',
    langUnsupported: (lang: string) => `Tu navegador no reconoce el ${lang}`,
    failed: (code: string) => `Error en el reconocimiento de voz (${code || 'desconocido'})`,
  },
} as const

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
export function speechErrorMessage(
  code: string,
  langName: string,
  serviceMissing: boolean,
  ui: UiLanguage = 'en',
): { text: string; blocked: boolean } | null {
  const t = TEXT[ui]
  switch (code) {
    case 'aborted':
      return null
    case 'no-speech':
      return { text: t.noSpeech, blocked: false }
    case 'network':
      return serviceMissing ? { text: t.needsChrome, blocked: true } : { text: t.unreachable, blocked: false }
    case 'service-not-allowed':
      return serviceMissing ? { text: t.needsChrome, blocked: true } : { text: t.blocked, blocked: true }
    case 'not-allowed':
      return { text: serviceMissing ? t.blockedOrChrome : t.blocked, blocked: true }
    case 'audio-capture':
      return { text: t.noMic, blocked: false }
    case 'language-not-supported':
      return { text: t.langUnsupported(langName), blocked: false }
    default:
      return { text: t.failed(code), blocked: false }
  }
}
