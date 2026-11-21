/** Text-to-speech through the browser's speechSynthesis (PLAN.md section 6). Silent when unsupported. */

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/** Speak `parts` in order in `lang` (a BCP 47 tag from LanguageConfig.ttsLang), cancelling anything playing. */
export function speak(parts: readonly (string | null | undefined)[], lang: string): void {
  if (!ttsSupported()) return
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const voice = synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.startsWith(lang.split('-')[0]!))
    for (const text of parts) {
      if (!text) continue
      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      if (voice) u.voice = voice
      synth.speak(u)
    }
  } catch {
    // Some browsers throw when speech is blocked; TTS is a nicety.
  }
}

export function stopSpeaking(): void {
  if (!ttsSupported()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // ignore
  }
}
