/**
 * Text-to-speech through the browser's speechSynthesis (PLAN.md section 6). Silent when unsupported.
 *
 * Chrome lists no voices on the first getVoices() call (they arrive with 'voiceschanged'), so the
 * list is loaded up front and cached; speak() waits up to VOICE_WAIT_MS for it when still empty.
 * The best voice of the language is chosen (rankVoices); when the device has none, nothing is
 * spoken (an English voice reading German is worse than silence) and the UI says so (useHasVoice).
 */
import { useSyncExternalStore } from 'react'
import { rankVoices } from './voices'

export { rankVoices }

export const VOICE_WAIT_MS = 1000
/** Single words read slightly slower. */
const RATE = 0.9

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

let voices: SpeechSynthesisVoice[] = []
let started = false
const listeners = new Set<() => void>()

function readVoices(): void {
  try {
    voices = window.speechSynthesis.getVoices()
  } catch {
    voices = []
  }
  for (const l of listeners) l()
}

/** Start loading the voice list (idempotent; also run on import). */
export function loadVoices(): void {
  if (started || !ttsSupported()) return
  started = true
  try {
    window.speechSynthesis.addEventListener('voiceschanged', readVoices)
  } catch {
    // Old browsers: only the onvoiceschanged property.
    window.speechSynthesis.onvoiceschanged = readVoices
  }
  readVoices()
}

loadVoices()

function waitForVoices(ms: number): Promise<void> {
  if (voices.length > 0) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      listeners.delete(onChange)
      clearTimeout(t)
      resolve()
    }
    const onChange = () => {
      if (voices.length > 0) done()
    }
    const t = setTimeout(done, ms)
    listeners.add(onChange)
  })
}

/** True or false once the voice list is known; null while it is still empty (unknown). */
export function hasVoice(lang: string): boolean | null {
  if (!ttsSupported() || voices.length === 0) return null
  return rankVoices(voices, lang).length > 0
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** False only when the device's voice list is known and has no voice for `lang`. */
export function useHasVoice(lang: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasVoice(lang) !== false,
    () => true,
  )
}

function speakNow(parts: readonly (string | null | undefined)[], lang: string): boolean {
  const synth = window.speechSynthesis
  const voice = rankVoices(voices, lang)[0]
  // A known list without this language: stay silent rather than read it in another accent.
  if (!voice && voices.length > 0) return false
  synth.cancel()
  for (const text of parts) {
    if (!text) continue
    const u = new SpeechSynthesisUtterance(text)
    u.lang = voice?.lang ?? lang
    if (voice) u.voice = voice
    u.rate = RATE
    synth.speak(u)
  }
  return true
}

/**
 * Speak `parts` in order in `lang` (a BCP 47 tag from LanguageConfig.ttsLang), cancelling anything
 * playing. Resolves false when nothing was spoken because the device has no voice for `lang`.
 * Speaks synchronously when the voices are already loaded (iOS needs the user gesture).
 */
export function speak(parts: readonly (string | null | undefined)[], lang: string): Promise<boolean> {
  if (!ttsSupported()) return Promise.resolve(false)
  loadVoices()
  const run = () => {
    try {
      return speakNow(parts, lang)
    } catch {
      // Some browsers throw when speech is blocked; TTS is a nicety.
      return false
    }
  }
  if (voices.length > 0) return Promise.resolve(run())
  return waitForVoices(VOICE_WAIT_MS).then(run)
}

export function stopSpeaking(): void {
  if (!ttsSupported()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // ignore
  }
}
