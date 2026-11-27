/** Study card pieces shared by Train and Learn: the card faces, Listen, the automatic grade and the four grade buttons. */
import { useEffect, useRef, useState } from 'react'
import type { CardFaces } from '../../shared/display'
import { isLanguageCode, LANGUAGES } from '../../shared/languages'
import { formatSeconds } from '../../shared/answerTiming'
import { GRADE_LABELS, GRADES, type Grade } from '../../shared/srs'
import { pronunciationVideoUrl } from '../lib/pronunciation'
import { ttsSupported, useHasVoice } from '../lib/tts'
import { muted, Sentence, Word } from './ui'
import { messages, useLanguageName, useT, useUiLang } from '../lib/i18n'
import type { UiLanguage } from '../../shared/languages'

const M = messages(
  {
    alsoInDeck: 'Also in your deck:',
    listen: 'Listen',
    video: 'Pronunciation video',
    newTab: ' (opens in a new tab)',
    noVoice: (name: string) =>
      `No ${name} voice on this device — use the video, install ${name} speech in your system settings, or try Chrome or Edge.`,
    howWell: 'How well did you know it?',
    grade: 'Grade: ',
    wasRight: 'I was right',
    changeGrade: 'Change grade',
    change: 'Change',
  },
  {
    alsoInDeck: 'También en tu mazo:',
    listen: 'Escuchar',
    video: 'Vídeo de pronunciación',
    newTab: ' (se abre en una pestaña nueva)',
    noVoice: (name) =>
      `No hay voz en ${name} en este dispositivo: usa el vídeo, instala la voz en ${name} en los ajustes del sistema o prueba con Chrome o Edge.`,
    howWell: '¿Qué tal te la sabías?',
    grade: 'Nota: ',
    wasRight: 'Tenía razón',
    changeGrade: 'Cambiar la nota',
    change: 'Cambiar',
  },
)

/** Grade names in the app language (GRADE_LABELS is the English set). */
const GRADE_NAMES: Readonly<Record<UiLanguage, Readonly<Record<Grade, string>>>> = {
  en: GRADE_LABELS,
  es: { 1: 'Otra vez', 2: 'Difícil', 3: 'Bien', 4: 'Fácil' },
}

/** The grade names ("Again" ... / "Otra vez" ...) in the current app language. */
export function useGradeNames(): Readonly<Record<Grade, string>> {
  return GRADE_NAMES[useUiLang()]
}

/** "2.1 s" in English, "2,1 s" in Spanish. */
export function formatSecondsIn(ms: number, ui: UiLanguage): string {
  const s = formatSeconds(ms)
  return ui === 'es' ? s.replace('.', ',') : s
}

const GRADE_STYLES: Record<Grade, string> = {
  1: 'border-red-300 text-red-800 dark:border-red-800 dark:text-red-300',
  2: 'border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300',
  3: 'border-green-300 text-green-800 dark:border-green-800 dark:text-green-300',
  4: 'border-blue-300 text-blue-800 dark:border-blue-800 dark:text-blue-300',
}

export function CardFront({ faces, lang }: { faces: CardFaces; lang: string }) {
  const f = faces.front
  if (f.kind === 'target') {
    return (
      <>
        <p className="text-4xl font-semibold tracking-tight">
          <Word text={f.word} lang={lang} />
        </p>
        {f.sentence && <p className="text-lg text-zinc-600 dark:text-zinc-300">{f.sentence}</p>}
      </>
    )
  }
  return (
    <>
      <p className="text-3xl font-semibold tracking-tight">{f.translation}</p>
      <Sentence text={f.sentence} className="text-lg text-zinc-600 dark:text-zinc-300" />
    </>
  )
}

/** The full card: word with coloured article, forms, translation, sentences, "Also in your deck", Listen. */
export function CardBack({
  back,
  word,
  lang,
  onSpeak,
}: {
  back: CardFaces['back']
  /** The spoken word (faces.speech.word, with the article), for the pronunciation video. */
  word: string
  lang: string
  onSpeak: () => Promise<boolean>
}) {
  const t = useT(M)
  return (
    <>
      <div>
        <p className="text-4xl font-semibold tracking-tight">
          <Word text={back.word} lang={lang} />
        </p>
        {back.forms && <p className={muted}>{back.forms}</p>}
      </div>
      <p className="text-xl">{back.translation}</p>
      <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <Sentence text={back.exampleTarget} className="text-base" />
        <Sentence text={back.exampleSource} className={muted} />
      </div>
      {back.alsoInDeck.length > 0 && <p className={muted}>{t.alsoInDeck} {back.alsoInDeck.map((o) => o.display).join(', ')}</p>}
      <ListenRow word={word} lang={lang} onSpeak={onSpeak} />
    </>
  )
}

/**
 * Listen (browser TTS) and a "Pronunciation video" link (a YouTube search). Without a voice for
 * the language the device stays silent and says so instead.
 */
export function ListenRow({ word, lang, onSpeak }: { word: string; lang: string; onSpeak: () => Promise<boolean> }) {
  const t = useT(M)
  const languageName = useLanguageName()
  const config = isLanguageCode(lang) ? LANGUAGES[lang] : null
  const name = languageName(lang)
  const voiceOk = useHasVoice(config?.ttsLang ?? lang)
  const [silent, setSilent] = useState(false)
  const tts = ttsSupported()
  const noVoice = tts && (!voiceOk || silent)
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {tts && (
          <button
            type="button"
            disabled={noVoice}
            className="inline-flex h-11 items-center rounded-lg border border-zinc-300 px-3 text-sm font-medium disabled:opacity-40 dark:border-zinc-700"
            onClick={(e) => {
              e.stopPropagation()
              void onSpeak().then((ok) => setSilent(!ok))
            }}
          >
            {t.listen}
          </button>
        )}
        <a
          href={pronunciationVideoUrl(word, lang)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-sm font-medium text-zinc-600 underline dark:text-zinc-300"
        >
          {t.video}<span className="sr-only">{t.newTab}</span>
        </a>
      </div>
      {noVoice && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t.noVoice(name)}</p>
      )}
    </div>
  )
}

export function GradeButtons({
  labels,
  disabled,
  onGrade,
  names,
  selected,
  focusSelected,
}: {
  labels: Record<Grade, string> | null
  disabled: boolean
  onGrade: (g: Grade) => void
  /** Button names replacing GRADE_LABELS (e.g. Good -> "I was right"). */
  names?: Partial<Record<Grade, string>>
  /** The grade "Next" will use, marked on its button. */
  selected?: Grade
  /** Focus the selected button on mount (opened with "Change"). */
  focusSelected?: boolean
}) {
  const t = useT(M)
  const gradeNames = useGradeNames()
  const selectedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusSelected) selectedRef.current?.focus()
  }, [focusSelected])
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label={t.howWell}>
      {GRADES.map((g) => (
        <button
          key={g}
          ref={selected === g ? selectedRef : undefined}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(g)}
          aria-current={selected === g ? 'true' : undefined}
          className={`flex h-16 flex-col items-center justify-center rounded-xl border text-sm font-medium disabled:opacity-40 ${GRADE_STYLES[g]} ${selected === g ? 'border-2 ring-2 ring-current/20' : ''}`}
        >
          <span>{names?.[g] ?? gradeNames[g]}</span>
          <span className="text-xs tabular-nums">{labels?.[g] ?? '…'}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * The automatic grade on a revealed card ("Good · 2.1 s"), as tall as GradeButtons so "Change"
 * swaps them without moving anything.
 */
export function GradeSummary({
  grade,
  timeMs,
  autoMs,
  disabled,
  onChange,
  onRight,
}: {
  grade: Grade
  /** Answer time (think + type), null for "Show answer". */
  timeMs: number | null
  /** Auto mode is about to move on in this many ms: a thin bar fills along the bottom. */
  autoMs?: number
  disabled: boolean
  onChange: () => void
  /** "I was right" (Good), offered when the answer was judged wrong or a typo. */
  onRight?: () => void
}) {
  const t = useT(M)
  const ui = useUiLang()
  const gradeNames = useGradeNames()
  const small = 'inline-flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium disabled:opacity-40'
  return (
    <div data-testid="grade-summary" className={`relative flex h-16 items-center gap-2 overflow-hidden rounded-xl border-2 px-3 ${GRADE_STYLES[grade]}`}>
      {autoMs !== undefined && <AutoProgress ms={autoMs} />}
      <p className="min-w-0 flex-1 text-left text-lg font-semibold">
        <span className="sr-only">{t.grade}</span>
        <span data-testid="auto-grade">
          {gradeNames[grade]}
          {timeMs !== null && <span className="tabular-nums"> · {formatSecondsIn(timeMs, ui)}</span>}
        </span>
      </p>
      {onRight && (
        <button type="button" disabled={disabled} onClick={onRight} className={`${small} border border-current`}>
          {t.wasRight}
        </button>
      )}
      <button type="button" disabled={disabled} onClick={onChange} aria-label={t.changeGrade} className={`${small} underline`}>
        {t.change}
      </button>
    </div>
  )
}

/** A bar filling over `ms` (Auto mode's countdown); absolutely placed, so nothing moves. */
function AutoProgress({ ms }: { ms: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function') return
    const a = el.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ms, easing: 'linear', fill: 'forwards' })
    return () => a.cancel()
  }, [ms])
  return (
    <span
      ref={ref}
      data-testid="auto-progress"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 bg-current opacity-60"
    />
  )
}
