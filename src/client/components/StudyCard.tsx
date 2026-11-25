/** Study card pieces shared by Train and Learn: the card faces, Listen and the four grade buttons. */
import { useState } from 'react'
import type { CardFaces } from '../../shared/display'
import { isLanguageCode, LANGUAGES } from '../../shared/languages'
import { GRADE_LABELS, GRADES, type Grade } from '../../shared/srs'
import { pronunciationVideoUrl } from '../lib/pronunciation'
import { ttsSupported, useHasVoice } from '../lib/tts'
import { muted, Sentence, Word } from './ui'

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
      {back.alsoInDeck.length > 0 && <p className={muted}>Also in your deck: {back.alsoInDeck.map((o) => o.display).join(', ')}</p>}
      <ListenRow word={word} lang={lang} onSpeak={onSpeak} />
    </>
  )
}

/**
 * Listen (browser TTS) and a "Pronunciation video" link (a YouTube search). Without a voice for
 * the language the device stays silent and says so instead.
 */
export function ListenRow({ word, lang, onSpeak }: { word: string; lang: string; onSpeak: () => Promise<boolean> }) {
  const config = isLanguageCode(lang) ? LANGUAGES[lang] : null
  const name = config?.name ?? lang
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
            Listen
          </button>
        )}
        <a
          href={pronunciationVideoUrl(word, lang)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-sm font-medium text-zinc-600 underline dark:text-zinc-300"
        >
          Pronunciation video<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      {noVoice && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          No {name} voice on this device — use the video, install {name} speech in your system settings, or try Chrome or Edge.
        </p>
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
}: {
  labels: Record<Grade, string> | null
  disabled: boolean
  onGrade: (g: Grade) => void
  /** Button names replacing GRADE_LABELS (e.g. Good -> "I was right"). */
  names?: Partial<Record<Grade, string>>
  /** The grade "Next" will use, marked on its button. */
  selected?: Grade
}) {
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you know it?">
      {GRADES.map((g) => (
        <button
          key={g}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(g)}
          aria-current={selected === g ? 'true' : undefined}
          className={`flex h-16 flex-col items-center justify-center rounded-xl border text-sm font-medium disabled:opacity-40 ${GRADE_STYLES[g]} ${selected === g ? 'border-2 ring-2 ring-current/20' : ''}`}
        >
          <span>{names?.[g] ?? GRADE_LABELS[g]}</span>
          <span className="text-xs tabular-nums">{labels?.[g] ?? '…'}</span>
        </button>
      ))}
    </div>
  )
}
