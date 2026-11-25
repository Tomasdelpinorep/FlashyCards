/**
 * The Learn intro card, in two steps (Learn.tsx drives the step):
 *   A: the source-language word and its example sentence;
 *   B: the target word with its article colour, part of speech, grammar (noun forms, the verb
 *      table, comparison, the case a preposition takes), the note, the example and Listen.
 */
import type { ReactNode } from 'react'
import { formsLine, verbTable, type IntroFaces } from '../../shared/display'
import type { CardDTO } from '../../shared/schemas'
import { ListenRow } from './StudyCard'
import { muted, Sentence, Word } from './ui'

export function LearnIntroCard({
  card,
  intro,
  step,
  targetLang,
  onSpeak,
}: {
  card: CardDTO
  intro: IntroFaces
  step: 0 | 1
  targetLang: string
  onSpeak: () => Promise<boolean>
}) {
  return (
    <div className="my-auto flex flex-col gap-4">
      <div>
        <p className={step === 0 ? 'text-3xl font-semibold tracking-tight' : 'text-lg text-zinc-600 dark:text-zinc-300'}>{intro.translation}</p>
        {step === 0 && <Sentence text={intro.exampleSource} className="mt-3 text-lg text-zinc-600 dark:text-zinc-300" />}
      </div>
      {step === 1 && (
        <>
          <div className="flex flex-col items-center gap-2">
            <p className="text-4xl font-semibold tracking-tight" lang={targetLang}>
              <Word text={intro.word} lang={targetLang} />
            </p>
            {card.content?.pos && (
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{card.content.pos}</span>
            )}
          </div>
          <Grammar card={card} targetLang={targetLang} />
          <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <Sentence text={intro.exampleTarget} className="text-base" />
            <Sentence text={intro.exampleSource} className={muted} />
          </div>
          {intro.alsoInDeck.length > 0 && <p className={muted}>Also in your deck: {intro.alsoInDeck.map((o) => o.display).join(', ')}</p>}
          <ListenRow word={intro.speech.word} lang={targetLang} onSpeak={onSpeak} />
        </>
      )}
    </div>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p>
      <span className="text-zinc-500 dark:text-zinc-400">{label}: </span>
      {children}
    </p>
  )
}

function Grammar({ card, targetLang }: { card: CardDTO; targetLang: string }) {
  const c = card.content
  const g = c?.grammar
  if (!c || !g) return null
  const note = g.note ? <p className={muted}>{g.note}</p> : null
  if (c.pos === 'noun') {
    if (!g.plural && !g.genitive && !note) return null
    return (
      <div className="flex flex-col gap-1 text-base" lang={targetLang}>
        {g.plural && (
          <Line label="Plural">
            <Word text={g.plural} lang={targetLang} />
          </Line>
        )}
        {g.genitive && <Line label="Genitive">{g.genitive}</Line>}
        {note}
      </div>
    )
  }
  if (c.pos === 'verb') {
    const rows = verbTable(c, targetLang)
    const v = g.verb
    if (!rows) {
      const forms = formsLine(c)
      return forms || note ? (
        <div className="flex flex-col gap-1">
          {forms && <p className={muted}>{forms}</p>}
          {note}
        </div>
      ) : null
    }
    const hasPast = rows.some((r) => r.past)
    return (
      <div className="flex flex-col gap-2">
        <table className="mx-auto text-left text-base" lang={targetLang} aria-label="Verb forms">
          <thead>
            <tr className="text-xs text-zinc-500 dark:text-zinc-400">
              <th scope="col" className="pr-4 font-medium">
                <span className="sr-only">Person</span>
              </th>
              <th scope="col" className="pr-4 font-medium">
                Present
              </th>
              {hasPast && (
                <th scope="col" className="font-medium">
                  Past
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <th scope="row" className="pr-4 font-normal text-zinc-500 dark:text-zinc-400">
                  {r.person}
                </th>
                <td className="pr-4">{r.present ?? '—'}</td>
                {hasPast && <td>{r.past ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {v?.perfect_3sg && (
          <p className="text-base" lang={targetLang}>
            <span className="text-zinc-500 dark:text-zinc-400">Perfect: </span>
            {v.perfect_3sg}
          </p>
        )}
        {note}
      </div>
    )
  }
  if (c.pos === 'adjective' || c.pos === 'adverb') {
    if (!g.comparative && !g.superlative && !note) return null
    return (
      <div className="flex flex-col gap-1 text-base" lang={targetLang}>
        {g.comparative && <Line label="Comparative">{g.comparative}</Line>}
        {g.superlative && <Line label="Superlative">{g.superlative}</Line>}
        {note}
      </div>
    )
  }
  if (g.governs_case || note) {
    return (
      <div className="flex flex-col gap-1 text-base">
        {g.governs_case && <p>+ {g.governs_case}</p>}
        {note}
      </div>
    )
  }
  return null
}
