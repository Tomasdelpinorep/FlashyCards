/**
 * The Learn intro card, in two steps (Learn.tsx drives the step):
 *   A: the source-language word and its example sentence;
 *   B: the target word with its article colour, part of speech, grammar (noun forms, the verb
 *      table, comparison, the case a preposition takes), the note, the example and Listen.
 */
import type { ReactNode } from 'react'
import { formsLine, governedCaseName, verbTable, type IntroFaces } from '../../shared/display'
import type { CardDTO } from '../../shared/schemas'
import { ListenRow } from './StudyCard'
import { muted, Sentence, Word } from './ui'
import { messages, useT, useUiLang } from '../lib/i18n'

const M = messages(
  {
    alsoInDeck: 'Also in your deck:',
    plural: 'Plural',
    genitive: 'Genitive',
    verbForms: 'Verb forms',
    person: 'Person',
    present: 'Present',
    past: 'Past',
    perfect: 'Perfect: ',
    comparative: 'Comparative',
    superlative: 'Superlative',
  },
  {
    alsoInDeck: 'También en tu mazo:',
    plural: 'Plural',
    genitive: 'Genitivo',
    verbForms: 'Formas verbales',
    person: 'Persona',
    present: 'Presente',
    past: 'Pretérito (Präteritum)',
    perfect: 'Perfekt: ',
    comparative: 'Comparativo',
    superlative: 'Superlativo',
  },
)

/** Part-of-speech names in Spanish; English shows the stored value as it is. */
const POS_ES: Readonly<Record<string, string>> = {
  noun: 'sustantivo',
  verb: 'verbo',
  adjective: 'adjetivo',
  adverb: 'adverbio',
  conjunction: 'conjunción',
  interjection: 'interjección',
  numeral: 'numeral',
  phrase: 'frase',
  preposition: 'preposición',
  pronoun: 'pronombre',
}

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
  const t = useT(M)
  const ui = useUiLang()
  const pos = card.content?.pos
  const posLabel = pos && ui === 'es' ? (POS_ES[pos] ?? pos) : pos
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
            {posLabel && (
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{posLabel}</span>
            )}
          </div>
          <Grammar card={card} targetLang={targetLang} />
          <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <Sentence text={intro.exampleTarget} className="text-base" />
            <Sentence text={intro.exampleSource} className={muted} />
          </div>
          {intro.alsoInDeck.length > 0 && <p className={muted}>{t.alsoInDeck} {intro.alsoInDeck.map((o) => o.display).join(', ')}</p>}
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
  const t = useT(M)
  const ui = useUiLang()
  const c = card.content
  const g = c?.grammar
  if (!c || !g) return null
  const note = g.note ? <p className={muted}>{g.note}</p> : null
  if (c.pos === 'noun') {
    if (!g.plural && !g.genitive && !note) return null
    return (
      <div className="flex flex-col gap-1 text-base" lang={targetLang}>
        {g.plural && (
          <Line label={t.plural}>
            <Word text={g.plural} lang={targetLang} />
          </Line>
        )}
        {g.genitive && <Line label={t.genitive}>{g.genitive}</Line>}
        {note}
      </div>
    )
  }
  if (c.pos === 'verb') {
    const rows = verbTable(c, targetLang)
    const v = g.verb
    if (!rows) {
      const forms = formsLine(c, ui)
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
        <table className="mx-auto text-left text-base" lang={targetLang} aria-label={t.verbForms}>
          <thead>
            <tr className="text-xs text-zinc-500 dark:text-zinc-400">
              <th scope="col" className="pr-4 font-medium">
                <span className="sr-only">{t.person}</span>
              </th>
              <th scope="col" className="pr-4 font-medium">
                {t.present}
              </th>
              {hasPast && (
                <th scope="col" className="font-medium">
                  {t.past}
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
            <span className="text-zinc-500 dark:text-zinc-400">{t.perfect}</span>
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
        {g.comparative && <Line label={t.comparative}>{g.comparative}</Line>}
        {g.superlative && <Line label={t.superlative}>{g.superlative}</Line>}
        {note}
      </div>
    )
  }
  if (g.governs_case || note) {
    return (
      <div className="flex flex-col gap-1 text-base">
        {g.governs_case && <p>+ {governedCaseName(g.governs_case, ui)}</p>}
        {note}
      </div>
    )
  }
  return null
}
