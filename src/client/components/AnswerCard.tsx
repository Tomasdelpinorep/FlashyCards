/**
 * One study card with a typed / spoken answer, shared by Train and the Learn quick check.
 *
 * answering -> revealed{result, grade} -> onDone(grade).
 * - A live-correct answer flips at once (no Enter); it waits there (Enter / Next moves on) so
 *   the learner can read the back.
 * - Enter with any other answer, or "Show answer", flips with the reason and a diff.
 * - The grade is automatic (src/shared/answerTiming.ts): wrong Again, typo Hard, a right answer
 *   Hard / Good / Easy from the think and typing time against the per-device calibration
 *   (lib/answerTiming.ts), which the answer then updates. The card shows it ("Good · 2.1 s");
 *   "Change" opens the grade buttons, keys 1-4 override at any time, "I was right" means Good.
 * - Auto mode (Train only, `autoAdvance`): a correct card shows its grade for AUTO_ADVANCE_MS,
 *   then moves on with it by itself; any tap, key or "Change" on the card cancels that.
 *   Wrong, typo and "Show answer" cards wait for Enter / Next as usual.
 * The caller records the review in onDone, i.e. when leaving the card, so an override never
 * sends two reviews. Remount (key) per card.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { diffChars, expectedFor, verdictText } from '../../shared/answerCheck'
import { answerPoints, effectiveCalibration, gradeFromTiming, typeParMs, updateCalibration } from '../../shared/answerTiming'
import type { CardFaces, FaceDirection } from '../../shared/display'
import { isLanguageCode, LANGUAGES } from '../../shared/languages'
import type { CardDTO } from '../../shared/schemas'
import type { Grade } from '../../shared/srs'
import { inputKind, loadCalibration, saveCalibration } from '../lib/answerTiming'
import { AUTO_ADVANCE_MS, shouldAutoAdvance } from '../lib/handsFree'
import { speak, stopSpeaking } from '../lib/tts'
import { AnswerInput, type AnswerResult } from './AnswerInput'
import { CardBack, CardFront, GradeButtons, GradeSummary, useGradeNames } from './StudyCard'
import { btnPrimary, btnSecondary, studyCard, studyFooter } from './ui'
import { messages, useT, useUiLang } from '../lib/i18n'

const M = messages(
  {
    theAnswerIs: (a: string) => `The answer is ${a}`,
    correct: '✓ Correct',
    card: 'Card',
    announce: (status: string, grade: string) => `${status}. Grade: ${grade}`,
    showAnswer: 'Show answer',
    next: 'Next',
    enter: 'Enter',
    wasRight: 'I was right',
    yourAnswer: 'Your answer',
    correctLabel: 'Correct',
  },
  {
    theAnswerIs: (a) => `La respuesta es ${a}`,
    correct: '✓ ¡Correcto!',
    card: 'Tarjeta',
    announce: (status, grade) => `${status}. Nota: ${grade}`,
    showAnswer: 'Ver respuesta',
    next: 'Siguiente',
    enter: 'Intro',
    wasRight: 'Tenía razón',
    yourAnswer: 'Tu respuesta',
    correctLabel: 'Correcta',
  },
)

export { AUTO_ADVANCE_MS }

type Revealed = { result: AnswerResult | null; grade: Grade }

/** The automatic grade of a result; the calibration then learns from it. */
function autoGrade(result: AnswerResult | null, answerText: string, lang: string, articleRequired: boolean): Grade {
  const kind = inputKind()
  const cal = loadCalibration(kind)
  const eff = effectiveCalibration(cal, kind)
  const points = answerPoints(answerText, lang, articleRequired)
  const verdict = result?.verdict ?? null
  const timing = result?.timing ?? null
  const grade = gradeFromTiming({ verdict, timing, typicalThinkMs: eff.thinkMs, typeParMs: typeParMs(points, eff.secPerPoint) })
  const next = updateCalibration(cal, kind, { verdict, timing, points })
  if (next !== cal) saveCalibration(kind, next)
  return grade
}

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
  autoAdvance = false,
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
  /** Auto mode: move on by itself after a correct answer. */
  autoAdvance?: boolean
  onReveal?: () => void
  onDone: (g: Grade) => void
}) {
  const t = useT(M)
  const ui = useUiLang()
  const gradeNames = useGradeNames()
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const [changing, setChanging] = useState(false)
  /** The learner interacted with the revealed card: no automatic move on. */
  const [held, setHeld] = useState(false)
  const nextRef = useRef<HTMLButtonElement>(null)
  const left = useRef(false)
  const shownOnce = useRef(false)
  const { expected, lang } = useMemo(() => expectedFor(card, direction, { sourceLang, targetLang }), [card, direction, sourceLang, targetLang])
  const ttsLang = isLanguageCode(targetLang) ? LANGUAGES[targetLang].ttsLang : targetLang
  const articleRequired = expected.isNoun && !!expected.article && isLanguageCode(lang) && LANGUAGES[lang].requireArticleForNouns

  const reveal = useCallback(
    (result: AnswerResult | null) => {
      if (shownOnce.current) return
      shownOnce.current = true
      setRevealed({ result, grade: autoGrade(result, result?.matched ?? expected.primary, lang, articleRequired) })
      onReveal?.()
      if (autoplay) speak([faces.speech.word], ttsLang)
    },
    [autoplay, faces.speech.word, ttsLang, onReveal, expected.primary, lang, articleRequired],
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

  const autoMoving = !!revealed && !changing && !held && shouldAutoAdvance(autoAdvance, revealed.result?.verdict ?? null, canGrade)

  useEffect(() => {
    if (!autoMoving || !revealed) return
    const grade = revealed.grade
    const t = setTimeout(() => leave(grade), AUTO_ADVANCE_MS)
    // Any tap or key cancels it (a grade key or Next still moves on, by its own handler).
    const hold = () => setHeld(true)
    window.addEventListener('pointerdown', hold, true)
    window.addEventListener('keydown', hold, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', hold, true)
      window.removeEventListener('keydown', hold, true)
    }
  }, [autoMoving, revealed, leave])

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
      ? verdictText(result, ui)
      : t.theAnswerIs(expected.primary)
    : ''
  const timeMs = result ? result.timing.thinkMs + (result.timing.typeMs ?? 0) : null
  const canClaimRight = !!result && result.verdict !== 'correct'
  const tone =
    result?.verdict === 'correct'
      ? 'text-green-700 dark:text-green-400'
      : result?.verdict === 'typo'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-red-700 dark:text-red-400'

  return (
    <>
      <section data-testid="study-card" aria-label={t.card} tabIndex={0} className={studyCard}>
        <div className="my-auto flex flex-col gap-4">
        {!revealed ? (
          <CardFront faces={faces} lang={targetLang} />
        ) : (
          <>
            <p className={`text-lg font-semibold ${tone}`} data-testid="verdict">
              {result?.verdict === 'correct' ? t.correct : status}
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
        {revealed ? t.announce(status, gradeNames[revealed.grade]) : ''}
      </p>

      {/* Tall enough for either state, so the card keeps its size when it flips. */}
      <div className={`${studyFooter} min-h-40`}>
      {!revealed ? (
        <>
          <AnswerInput expected={expected} lang={lang} kind={lang === targetLang ? 'word' : 'meaning'} onResult={reveal} />
          <button type="button" className={btnSecondary} onClick={() => reveal(null)}>
            {t.showAnswer}
          </button>
        </>
      ) : (
        <>
          <button ref={nextRef} type="button" className={btnPrimary} disabled={!canGrade} onClick={() => leave(revealed.grade)}>
            {t.next} <span className="ml-2 text-xs font-normal">{t.enter}</span>
          </button>
          {changing ? (
            <GradeButtons
              labels={labels}
              disabled={!canGrade}
              onGrade={leave}
              selected={revealed.grade}
              focusSelected
              names={canClaimRight ? { 3: t.wasRight } : undefined}
            />
          ) : (
            <GradeSummary
              grade={revealed.grade}
              timeMs={timeMs}
              autoMs={autoMoving ? AUTO_ADVANCE_MS : undefined}
              disabled={!canGrade}
              onChange={() => setChanging(true)}
              onRight={canClaimRight ? () => leave(3) : undefined}
            />
          )}
        </>
      )}
      </div>
    </>
  )
}

/** "Your answer" with the wrong letters struck through, and the right answer with the missing ones marked. */
function AnswerDiff({ input, expected }: { input: string; expected: string }) {
  const t = useT(M)
  const segs = diffChars(input, expected)
  return (
    <dl className="mx-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-left text-base">
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">{t.yourAnswer}</dt>
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
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">{t.correctLabel}</dt>
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
