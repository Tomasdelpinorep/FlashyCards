/**
 * Spoken answers through the browser's Web Speech API (SpeechRecognition). In Chrome the audio
 * is sent to Google's speech service (free, no key); see docs/DECISIONS.md. Hidden when the
 * browser has no recognizer (Firefox, some iOS versions).
 */

import { speechServiceMissing } from './speechErrors'

export { speechErrorMessage } from './speechErrors'

type RecognitionAlternative = { transcript: string }
type RecognitionResult = { isFinal: boolean; length: number; [i: number]: RecognitionAlternative }
type RecognitionEvent = { results: { length: number; [i: number]: RecognitionResult } }
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onspeechstart?: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Checked on render and again on click (iOS exposes the constructor late or not at all). */
export function isSpeechSupported(): boolean {
  return ctor() !== null
}

export function browserLacksSpeechService(): boolean {
  if (typeof navigator === 'undefined') return false
  return speechServiceMissing(navigator as unknown as Parameters<typeof speechServiceMissing>[0])
}

export type ListenOptions = {
  lang: string
  /** The best transcript so far, while speaking. */
  onInterim: (transcript: string) => void
  /** All alternatives of the final result (best first); empty when nothing was heard. */
  onFinal: (transcripts: string[]) => void
  /** The raw error code ('network', 'not-allowed', ...; see speechErrorMessage). */
  onError: (code: string) => void
  /** The recognizer hears speech. */
  onSpeech?: () => void
  /** Recognition stopped (after a final result, an error or stop()). */
  onEnd?: () => void
}

/** Start one utterance of recognition. Returns a function that stops it. */
export function startListening(opts: ListenOptions): () => void {
  const C = ctor()
  if (!C) {
    opts.onError('unsupported')
    opts.onEnd?.()
    return () => {}
  }
  const r = new C()
  r.lang = opts.lang
  r.interimResults = true
  r.continuous = false
  r.maxAlternatives = 3
  let finished = false
  r.onresult = (e) => {
    const last = e.results[e.results.length - 1]
    if (!last) return
    if (last.isFinal) {
      finished = true
      const all: string[] = []
      for (let i = 0; i < last.length; i++) {
        const t = last[i]?.transcript.trim()
        if (t && !all.includes(t)) all.push(t)
      }
      opts.onFinal(all)
    } else opts.onInterim(last[0]?.transcript ?? '')
  }
  r.onerror = (e) => {
    finished = true
    opts.onError(e.error)
  }
  r.onspeechstart = () => opts.onSpeech?.()
  r.onend = () => {
    if (!finished) opts.onFinal([])
    opts.onEnd?.()
  }
  try {
    r.start()
  } catch {
    opts.onError('start-failed')
    opts.onEnd?.()
    return () => {}
  }
  return () => {
    try {
      r.stop()
    } catch {
      // already stopped
    }
  }
}
