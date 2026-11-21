/** Study card pieces shared by Train and Learn: the card faces and the four grade buttons. */
import type { CardFaces } from '../../shared/display'
import { GRADE_LABELS, GRADES, type Grade } from '../../shared/srs'
import { ttsSupported } from '../lib/tts'
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
export function CardBack({ back, lang, onSpeak }: { back: CardFaces['back']; lang: string; onSpeak: () => void }) {
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
      {ttsSupported() && (
        <button
          type="button"
          className="mx-auto inline-flex h-9 items-center rounded-lg border border-zinc-300 px-3 text-sm font-medium dark:border-zinc-700"
          onClick={(e) => {
            e.stopPropagation()
            onSpeak()
          }}
        >
          Listen
        </button>
      )}
    </>
  )
}

export function GradeButtons({
  labels,
  disabled,
  onGrade,
}: {
  labels: Record<Grade, string> | null
  disabled: boolean
  onGrade: (g: Grade) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you know it?">
      {GRADES.map((g) => (
        <button
          key={g}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(g)}
          className={`flex h-16 flex-col items-center justify-center rounded-xl border text-sm font-medium disabled:opacity-40 ${GRADE_STYLES[g]}`}
        >
          <span>{GRADE_LABELS[g]}</span>
          <span className="text-xs tabular-nums opacity-70">{labels?.[g] ?? '…'}</span>
        </button>
      ))}
    </div>
  )
}
