/**
 * The answer box of Train and the Learn quick check: type (or say) the answer.
 *
 * - Live check on every change: an exact match (src/shared/answerCheck.ts) is reported at once,
 *   no Enter needed.
 * - Enter reports the final check whatever the verdict (the card then flips).
 * - A 1.5 s pause, leaving the box, or the end of speech only shows an inline hint when the
 *   answer is not right yet: flipping on a wrong answer needs Enter or "Show answer".
 */
import { useEffect, useRef, useState } from 'react'
import { checkAnyAnswer, type CheckResult, type Expected } from '../../shared/answerCheck'
import { isLanguageCode, LANGUAGES } from '../../shared/languages'
import { isSpeechSupported, startListening } from '../lib/speech'
import { input as inputClass } from './ui'

export const PAUSE_MS = 1500

export type AnswerResult = CheckResult & { input: string }

/** Once the browser refuses the microphone, the mic stays off for this page session. */
let micBlocked = false

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
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(micBlocked ? 'Microphone blocked — allow it in the browser settings' : null)
  const [speechOk, setSpeechOk] = useState(() => isSpeechSupported())
  const done = useRef(false)
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const config = isLanguageCode(lang) ? LANGUAGES[lang] : null
  const langName = config?.name ?? lang
  const label = `Type the ${langName} ${kind}`
  const needsArticle = expected.isNoun && !!expected.article && !!config?.requireArticleForNouns

  useEffect(
    () => () => {
      if (pause.current) clearTimeout(pause.current)
      stopRef.current?.()
    },
    [],
  )

  const report = (r: AnswerResult) => {
    if (done.current) return
    done.current = true
    if (pause.current) clearTimeout(pause.current)
    stopRef.current?.()
    onResult(r)
  }

  /** A soft final check (pause, blur, end of speech): flips only when correct, else hints. */
  const soft = (inputs: string[]) => {
    if (done.current || inputs.every((s) => !s.trim())) return
    const r = checkAnyAnswer(inputs, expected, lang, 'final')
    if (r.verdict === 'correct') report(r)
    else setHint(HINTS[r.verdict] ?? null)
  }

  const change = (v: string) => {
    setValue(v)
    setHint(null)
    if (pause.current) clearTimeout(pause.current)
    const r = checkAnyAnswer([v], expected, lang, 'live')
    if (r.verdict === 'correct') return report(r)
    if (v.trim()) pause.current = setTimeout(() => soft([v]), PAUSE_MS)
  }

  const submit = () => {
    if (!value.trim()) return
    report(checkAnyAnswer([value], expected, lang, 'final'))
  }

  const toggleMic = () => {
    if (listening) {
      stopRef.current?.()
      return
    }
    if (!isSpeechSupported()) {
      setSpeechOk(false)
      return
    }
    setMicError(null)
    setListening(true)
    stopRef.current = startListening({
      lang: config?.ttsLang ?? lang,
      onInterim: (t) => {
        if (t) change(t)
      },
      onFinal: (all) => {
        if (all.length === 0) return
        setValue(all[0]!)
        const live = checkAnyAnswer(all, expected, lang, 'live')
        if (live.verdict === 'correct') report(live)
        else soft(all)
      },
      onError: (e) => {
        if (e === 'blocked') {
          micBlocked = true
          setMicError('Microphone blocked — allow it in the browser settings')
        } else if (e === 'no-speech') setMicError('Didn’t catch that — try again')
      },
      onEnd: () => {
        stopRef.current = null
        setListening(false)
        inputRef.current?.focus()
      },
    })
  }

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
          onBlur={() => soft([value])}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        {speechOk && (
          <button
            type="button"
            aria-pressed={listening}
            aria-label={listening ? 'Stop listening' : 'Say the answer'}
            disabled={micBlocked}
            onClick={toggleMic}
            className={`inline-flex h-11 min-w-11 shrink-0 items-center justify-center self-center rounded-xl border disabled:opacity-40 ${
              listening ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300' : 'border-zinc-300 dark:border-zinc-700'
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
      </div>
      {(hint || micError) && <p aria-hidden="true" className="text-sm font-medium text-amber-800 dark:text-amber-300">{hint ?? micError}</p>}
      <p className="sr-only" aria-live="polite">
        {hint ?? micError ?? (listening ? 'Listening' : '')}
      </p>
    </div>
  )
}
