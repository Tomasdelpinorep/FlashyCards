/**
 * One study card with a typed / spoken answer, shared by Train and the Learn quick check.
 *
 * answering -> revealed{result, grade} -> onDone(grade).
 * - A live-correct answer flips at once (no Enter) and grades Good; it moves on by itself after
 *   1.2 s unless the learner touches anything.
 * - Enter with any other answer, or "Show answer", flips with the reason and a diff; the default
 *   grade is Hard for a typo, else Again, and it moves on only with Enter / Next.
 * - On the revealed card the grade buttons (and keys 1-4) override the grade and move on.
 * The caller records the review in onDone, i.e. when leaving the card, so an override never
 * sends two reviews. Remount (key) per card.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { diffChars, expectedFor, gradeForVerdict, verdictText } from '../../shared/answerCheck'
import type { CardFaces, FaceDirection } from '../../shared/display'
import { isLanguageCode, LANGUAGES } from '../../shared/languages'
import type { CardDTO } from '../../shared/schemas'
import type { Grade } from '../../shared/srs'
import { speak, stopSpeaking } from '../lib/tts'
import { AnswerInput, type AnswerResult } from './AnswerInput'
import { CardBack, CardFront, GradeButtons } from './StudyCard'
import { btnPrimary, btnSecondary, studyCard, studyFooter } from './ui'

export const AUTO_ADVANCE_MS = 1200

type Revealed = { result: AnswerResult | null; grade: Grade }

function isTyping(): boolean {
  const el = document.activeElement
  return el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

export function AnswerCard({
  card,
  faces,
  direction,
  sourceLang,
  targetLang,
  labels,
  canGrade,
  autoplay,
  onReveal,
  onDone,
}: {
  card: CardDTO
  faces: CardFaces
  direction: FaceDirection
  sourceLang: string
  targetLang: string
  labels: Record<Grade, string> | null
  canGrade: boolean
  autoplay: boolean
  onReveal?: () => void
  onDone: (g: Grade) => void
}) {
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const left = useRef(false)
  const shownOnce = useRef(false)
  const { expected, lang } = useMemo(() => expectedFor(card, direction, { sourceLang, targetLang }), [card, direction, sourceLang, targetLang])
  const ttsLang = isLanguageCode(targetLang) ? LANGUAGES[targetLang].ttsLang : targetLang

  const reveal = useCallback(
    (result: AnswerResult | null) => {
      if (shownOnce.current) return
      shownOnce.current = true
      setRevealed({ result, grade: result ? gradeForVerdict(result.verdict) : 1 })
      onReveal?.()
      if (autoplay) speak([faces.speech.word], ttsLang)
    },
    [autoplay, faces.speech.word, ttsLang, onReveal],
  )

  const leave = useCallback(
    (g: Grade) => {
      if (left.current || !canGrade) return
      left.current = true
      stopSpeaking()
      onDone(g)
    },
    [canGrade, onDone],
  )

  // Focus Next on reveal (so Enter moves on and screen readers land on the result).
  useEffect(() => {
    if (revealed) nextRef.current?.focus()
  }, [revealed])

  // A live-correct answer moves on by itself unless the learner interacts.
  const correct = revealed?.result?.verdict === 'correct'
  useEffect(() => {
    if (!correct || !revealed) return
    const t = setTimeout(() => leave(revealed.grade), AUTO_ADVANCE_MS)
    const cancel = () => clearTimeout(t)
    window.addEventListener('pointerdown', cancel, true)
    window.addEventListener('keydown', cancel, true)
    return () => {
      cancel()
      window.removeEventListener('pointerdown', cancel, true)
      window.removeEventListener('keydown', cancel, true)
    }
  }, [correct, revealed, leave])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The answer box handles its own keys; an Enter that revealed the card is already handled.
      if (e.defaultPrevented || e.repeat || isTyping()) return
      if (!revealed) {
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault()
          reveal(null)
        }
        return
      }
      if (e.key === 'Enter') {
        // A focused button (Next, a grade) handles its own Enter as a click.
        if (document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLAnchorElement) return
        e.preventDefault()
        leave(revealed.grade)
      } else if (/^[1-4]$/.test(e.key)) {
        // Not typed into the next card's answer box, which takes the focus right away.
        e.preventDefault()
        leave(Number(e.key) as Grade)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, reveal, leave])

  const result = revealed?.result ?? null
  const status = revealed
    ? result && result.input.trim()
      ? verdictText(result)
      : `The answer is ${expected.primary}`
    : ''
  const tone =
    result?.verdict === 'correct'
      ? 'text-green-700 dark:text-green-400'
      : result?.verdict === 'typo'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-red-700 dark:text-red-400'

  return (
    <>
      <section data-testid="study-card" aria-label="Card" tabIndex={0} className={studyCard}>
        <div className="my-auto flex flex-col gap-4">
        {!revealed ? (
          <CardFront faces={faces} lang={targetLang} />
        ) : (
          <>
            <p className={`text-lg font-semibold ${tone}`} data-testid="verdict">
              {result?.verdict === 'correct' ? '✓ Correct' : status}
            </p>
            {result && result.verdict !== 'correct' && result.input.trim() && <AnswerDiff input={result.input} expected={result.shown} />}
            <CardBack
              back={faces.back}
              word={faces.speech.word}
              lang={targetLang}
              onSpeak={() => speak([faces.speech.word, faces.speech.sentence], ttsLang)}
            />
          </>
        )}
        </div>
      </section>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      {/* Tall enough for either state, so the card keeps its size when it flips. */}
      <div className={`${studyFooter} min-h-40`}>
      {!revealed ? (
        <>
          <AnswerInput expected={expected} lang={lang} kind={lang === targetLang ? 'word' : 'meaning'} onResult={reveal} />
          <button type="button" className={btnSecondary} onClick={() => reveal(null)}>
            Show answer
          </button>
        </>
      ) : (
        <>
          <button ref={nextRef} type="button" className={btnPrimary} disabled={!canGrade} onClick={() => leave(revealed.grade)}>
            Next <span className="ml-2 text-xs opacity-60">Enter</span>
          </button>
          <GradeButtons
            labels={labels}
            disabled={!canGrade}
            onGrade={leave}
            selected={revealed.grade}
            names={revealed.grade < 3 ? { 3: 'I was right' } : undefined}
          />
        </>
      )}
      </div>
    </>
  )
}

/** "Your answer" with the wrong letters struck through, and the right answer with the missing ones marked. */
function AnswerDiff({ input, expected }: { input: string; expected: string }) {
  const segs = diffChars(input, expected)
  return (
    <dl className="mx-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-left text-base">
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">Your answer</dt>
      <dd>
        {segs
          .filter((s) => s.op !== 'insert')
          .map((s, i) =>
            s.op === 'delete' ? (
              <del key={i} className="rounded bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                {s.text}
              </del>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
      </dd>
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">Correct</dt>
      <dd>
        {segs
          .filter((s) => s.op !== 'delete')
          .map((s, i) =>
            s.op === 'insert' ? (
              <ins key={i} className="rounded bg-green-100 font-semibold text-green-800 no-underline dark:bg-green-950 dark:text-green-300">
                {s.text}
              </ins>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
      </dd>
    </dl>
  )
}
