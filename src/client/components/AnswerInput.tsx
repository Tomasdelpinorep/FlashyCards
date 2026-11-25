/**
 * The answer box of Train and the Learn quick check: type (or say) the answer.
 *
 * - Live check on every change: an exact match (src/shared/answerCheck.ts) is reported at once,
 *   no Enter needed.
 * - Enter reports the final check whatever the verdict (the card then flips).
 * - A 1.5 s pause, leaving the box, or the end of speech only shows an inline hint when the
 *   answer is not right yet: flipping on a wrong answer needs Enter or "Show answer".
 * - Speech: the mic button is a switch (lib/handsFree.ts micSwitch) that stays on from card to
 *   card and across reloads. While on, an unanswered card listens by itself, again after an
 *   empty result (MIC_MAX_EMPTY in a row pause it: "Mic paused"), not while the tab is hidden;
 *   typing still works. Interim transcripts fill the box and flip on an exact match, but start
 *   no pause timer (that would hint mid-utterance); the final result gets the soft check. Any
 *   other recognition error is shown (lib/speech.ts speechErrorMessage) and turns the switch off.
 * - Timing (src/shared/answerTiming.ts): thinkMs = box ready -> first keystroke or speech start,
 *   typeMs = first input -> the reported result (null when spoken); time on a hidden page
 *   does not count (lib/answerTiming.ts VisibleClock).
 */
import { useEffect, useRef, useState } from 'react'
import { checkAnyAnswer, type CheckResult, type Expected } from '../../shared/answerCheck'
import { capTiming, type Timing } from '../../shared/answerTiming'
import { isLanguageCode, LANGUAGES } from '../../shared/languages'
import { browserLacksSpeechService, isSpeechSupported, speechErrorMessage, startListening } from '../lib/speech'
import { VisibleClock } from '../lib/answerTiming'
import { MIC_PAUSED, micAfterEnd, micSwitch, useSwitch } from '../lib/handsFree'
import { input as inputClass } from './ui'

export const PAUSE_MS = 1500

export type AnswerResult = CheckResult & { input: string; timing: Timing }

/** Once the browser refuses the microphone (or has no speech service), the mic stays off for this page session. */
let micBlocked: string | null = null

const HINTS: Partial<Record<CheckResult['verdict'], string>> = {
  typo: 'Almost — check the spelling',
  'missing-article': 'Add the article',
  'wrong-article': 'Check the article',
  wrong: 'Not quite — keep trying, or press Enter',
}

export function AnswerInput({
  expected,
  lang,
  kind,
  onResult,
}: {
  /** "word" (the target-language word) or "meaning" (its translation), for the label. */
  kind: 'word' | 'meaning'
  expected: Expected
  /** The language the answer is written in. */
  lang: string
  /** A result that should flip the card: a correct answer, or any answer submitted with Enter. */
  onResult: (r: AnswerResult) => void
}) {
  const [value, setValue] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const micOn = useSwitch(micSwitch)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [restart, setRestart] = useState(0)
  const empties = useRef(0)
  const [listening, setListening] = useState(false)
  const [hearing, setHearing] = useState(false)
  const [micError, setMicError] = useState<string | null>(micBlocked)
  const [speechOk, setSpeechOk] = useState(() => isSpeechSupported())
  const done = useRef(false)
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const micRef = useRef<HTMLButtonElement>(null)
  const clock = useRef<VisibleClock | null>(null)
  /** Visible ms from the box being ready to the first keystroke / speech, once known. */
  const firstInput = useRef<number | null>(null)

  const config = isLanguageCode(lang) ? LANGUAGES[lang] : null
  const langName = config?.name ?? lang
  const label = `Type the ${langName} ${kind}`
  const needsArticle = expected.isNoun && !!expected.article && !!config?.requireArticleForNouns

  useEffect(() => {
    clock.current = new VisibleClock()
    return () => {
      clock.current?.dispose()
      if (pause.current) clearTimeout(pause.current)
      stopRef.current?.()
    }
  }, [])

  const markInput = () => {
    if (firstInput.current === null) firstInput.current = clock.current?.elapsed() ?? 0
  }

  /** `spoken`: the result came from speech (no typing component). */
  const report = (r: CheckResult & { input: string }, spoken: boolean) => {
    if (done.current) return
    done.current = true
    if (pause.current) clearTimeout(pause.current)
    stopRef.current?.()
    const end = clock.current?.elapsed() ?? 0
    const first = firstInput.current ?? end
    onResult({ ...r, timing: capTiming(first, spoken ? null : end - first) })
  }

  /** A soft final check (pause, blur, end of speech): flips only when correct, else hints. */
  const soft = (inputs: string[], spoken = false) => {
    if (done.current || inputs.every((s) => !s.trim())) return
    const r = checkAnyAnswer(inputs, expected, lang, 'final')
    if (r.verdict === 'correct') report(r, spoken)
    else setHint(HINTS[r.verdict] ?? null)
  }

  /** `timer`: start the pause check (typing only; speech gets its check on the final result). */
  const change = (v: string, timer = true) => {
    if (v) markInput()
    setValue(v)
    setHint(null)
    if (pause.current) clearTimeout(pause.current)
    const r = checkAnyAnswer([v], expected, lang, 'live')
    if (r.verdict === 'correct') return report(r, !timer)
    if (timer && v.trim()) pause.current = setTimeout(() => soft([v]), PAUSE_MS)
  }

  const submit = () => {
    if (!value.trim()) return
    report(checkAnyAnswer([value], expected, lang, 'final'), false)
  }

  // The mic switch (lib/handsFree.ts): while on, an unanswered card listens by itself.
  const active = micOn && speechOk && !micBlocked && visible

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (!active || done.current) return
    let cancelled = false
    let ended = false
    let heard = false
    let fatal = false
    setListening(true)
    setHearing(false)
    const stop = startListening({
      lang: config?.ttsLang ?? lang,
      onInterim: (t) => {
        if (!t || cancelled) return
        heard = true
        change(t, false)
      },
      onSpeech: () => {
        if (cancelled) return
        markInput()
        setHearing(true)
      },
      onFinal: (all) => {
        if (all.length === 0 || cancelled) return
        heard = true
        setValue(all[0]!)
        const live = checkAnyAnswer(all, expected, lang, 'live')
        if (live.verdict === 'correct') report(live, true)
        else soft(all, true)
      },
      onError: (code) => {
        // Nothing heard ('no-speech'): the end handler listens again, or pauses.
        if (cancelled || code === 'no-speech' || code === 'aborted') return
        fatal = true
        if (code === 'unsupported') setSpeechOk(false)
        const m = speechErrorMessage(code, langName, browserLacksSpeechService())
        if (m?.blocked) micBlocked = m.text
        if (m) setMicError(m.text)
        micSwitch.set(false)
      },
      onEnd: () => {
        ended = true
        if (cancelled) return
        stopRef.current = null
        setListening(false)
        setHearing(false)
        if (done.current || fatal) return
        const next = micAfterEnd(empties.current, heard)
        empties.current = next.streak
        if (next.action === 'pause') {
          setMicError(MIC_PAUSED)
          micSwitch.set(false)
        } else setRestart((n) => n + 1)
      },
    })
    // A recognizer that failed to start has already ended (synchronously).
    if (!ended) stopRef.current = stop
    return () => {
      cancelled = true
      stopRef.current = null
      setListening(false)
      setHearing(false)
      stop()
    }
    // Reruns only when switched, shown / hidden, or to listen again; the handlers read this
    // card's props, which don't change while it is mounted (remounted per card).
  }, [active, restart])

  const toggleMic = () => {
    if (micOn) {
      micSwitch.set(false)
      setMicError(null)
      inputRef.current?.focus()
      return
    }
    if (!isSpeechSupported()) {
      setSpeechOk(false)
      return
    }
    empties.current = 0
    setMicError(null)
    setHint(null)
    if (pause.current) clearTimeout(pause.current)
    micSwitch.set(true)
    inputRef.current?.focus()
  }

  const status = listening ? (hearing ? 'Hearing you…' : 'Listening… speak now') : ''

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="answer" className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          id="answer"
          className={inputClass}
          value={value}
          lang={config?.ttsLang ?? lang}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={needsArticle ? 'With the article' : undefined}
          autoFocus
          onChange={(e) => change(e.target.value)}
          onBlur={(e) => {
            // Tapping the mic (or listening) is not leaving the box.
            if (listening || e.relatedTarget === micRef.current) return
            soft([value])
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        {speechOk && (
          <button
            ref={micRef}
            type="button"
            aria-pressed={micOn}
            aria-label="Answer by voice"
            title={micOn ? 'Voice input on' : 'Voice input off'}
            disabled={!!micBlocked && !micOn}
            onClick={toggleMic}
            className={`inline-flex h-11 min-w-11 shrink-0 items-center justify-center self-center rounded-xl border disabled:opacity-40 ${
              micOn
                ? `border-red-700 bg-red-700 text-white dark:border-red-500 dark:bg-red-600 ${listening ? 'ring-2 ring-red-300 ring-offset-1 dark:ring-red-800' : ''}`
                : 'border-zinc-300 dark:border-zinc-700'
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
      </div>
      {/* Always one line tall, so the buttons under the box don't move when a hint shows. */}
      <p aria-hidden="true" className={`min-h-5 text-sm font-medium ${hint || micError ? 'text-amber-800 dark:text-amber-300' : 'text-zinc-600 dark:text-zinc-300'}`}>
        {hint ?? micError ?? status}
      </p>
      <p className="sr-only" aria-live="polite">
        {hint ?? micError ?? status}
      </p>
    </div>
  )
}
