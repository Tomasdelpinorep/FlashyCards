import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { LANGUAGES, type LanguageCode } from '../../shared/languages'
import {
  keyRows,
  MAX_IMPORT_ROWS,
  parseImport,
  splitInFileDuplicates,
  type InputLang,
} from '../../shared/parseImport'
import type { DeckStats, ImportResponse, SuggestResponse } from '../../shared/schemas'
import { GenerationBanner } from '../components/GenerationBanner'
import { ImportSummary } from '../components/ImportSummary'
import { btnPrimary, btnSecondary, btnSmall, card, ErrorText, input, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { isAiUnavailable, suggestUnavailableText, useGeneration } from '../lib/generation'
import { duplicateText, invalidReason } from '../lib/importCopy'
import { messages, useLanguageName, useT, useUiLang } from '../lib/i18n'
import { useDeckStats, useImport, useSuggest } from '../lib/queries'

const M = messages(
  {
    title: 'Add words',
    tabSuggest: 'Add new words',
    tabImport: 'Import',
    moreDuplicates: (n: number) => `${n} more already in your deck (found while looking up)`,
    noneLeft: 'No new words left',
    exhausted: "You've added every word in the dictionary. Type your own words to keep going.",
    noneFound: 'No new words found',
    tryLater: 'Try again in a moment, or import your own words.',
    learnNow: 'Learn them now',
    seeWords: 'See your words',
    back: 'Back',
    addMore: 'Add more',
    fromWordlist: (lang: string) => `Adds the most common ${lang} words you don't have yet, in order of frequency.`,
    fromAi: (lang: string) => `Common ${lang} words you don't have yet, picked by AI (there is no bundled word list for ${lang}).`,
    howMany: 'How many words?',
    custom: 'Custom',
    numberOfWords: (max: number) => `Number of words (1–${max})`,
    adding: 'Adding…',
    addN: (n: number) => `Add ${n} word${n === 1 ? '' : 's'}`,
    add: 'Add',
    fileTooLarge: 'That file is too large (max 1 MB).',
    fileUnreadable: "Couldn't read that file.",
    importMore: 'Import more',
    auto: 'Auto',
    oneWordPerLine: 'One word per line',
    placeholderFallback: 'word\nword;translation',
    placeholderComment: '# lines starting with # are ignored',
    separatorHelp: 'Add a meaning or translation after a tab, “;” or “|”.',
    chooseFile: 'Choose file…',
    forget: 'forget',
    wordsAreIn: 'The words are in',
    preview: 'Preview',
    toImport: (n: number) => `${n} word${n === 1 ? '' : 's'} to import`,
    skippingHeader: (line: number) => `Skipping the header row (line ${line}).`,
    tooMany: (rows: number, max: number) => `This list has ${rows} rows. Import at most ${max} at a time.`,
    more: (n: number) => `+${n} more`,
    listedTwice: (n: number) => `${n} listed twice (skipped)`,
    line: (n: number) => `Line ${n}`,
    sameAs: (n: number) => `(same as line ${n})`,
    cantRead: (n: number) => `${n} can't be read`,
    importing: 'Importing…',
    importN: (n: number) => `Import ${n} word${n === 1 ? '' : 's'}`,
    import: 'Import',
  },
  {
    title: 'Añadir palabras',
    tabSuggest: 'Añadir palabras nuevas',
    tabImport: 'Importar',
    moreDuplicates: (n) => `${n} más ya en tu mazo (encontradas al buscarlas)`,
    noneLeft: 'No quedan palabras nuevas',
    exhausted: 'Ya has añadido todas las palabras del diccionario. Escribe tus propias palabras para seguir.',
    noneFound: 'No se han encontrado palabras nuevas',
    tryLater: 'Vuelve a intentarlo en un momento, o importa tus propias palabras.',
    learnNow: 'Aprenderlas ahora',
    seeWords: 'Ver tus palabras',
    back: 'Volver',
    addMore: 'Añadir más',
    fromWordlist: (lang) => `Añade las palabras más comunes en ${lang} que aún no tienes, por orden de frecuencia.`,
    fromAi: (lang) => `Palabras comunes en ${lang} que aún no tienes, elegidas por IA (no hay una lista de palabras incluida para el ${lang}).`,
    howMany: '¿Cuántas palabras?',
    custom: 'Otra',
    numberOfWords: (max) => `Número de palabras (1–${max})`,
    adding: 'Añadiendo…',
    addN: (n) => (n === 1 ? 'Añadir 1 palabra' : `Añadir ${n} palabras`),
    add: 'Añadir',
    fileTooLarge: 'Ese archivo es demasiado grande (máx. 1 MB).',
    fileUnreadable: 'No se pudo leer ese archivo.',
    importMore: 'Importar más',
    auto: 'Auto',
    oneWordPerLine: 'Una palabra por línea',
    placeholderFallback: 'palabra\npalabra;traducción',
    placeholderComment: '# las líneas que empiezan por # se ignoran',
    separatorHelp: 'Añade un significado o una traducción tras un tabulador, “;” o “|”.',
    chooseFile: 'Elegir archivo…',
    forget: 'quitar',
    wordsAreIn: 'Las palabras están en',
    preview: 'Vista previa',
    toImport: (n) => (n === 1 ? '1 palabra para importar' : `${n} palabras para importar`),
    skippingHeader: (line) => `Se omite la fila de encabezado (línea ${line}).`,
    tooMany: (rows, max) => `Esta lista tiene ${rows} filas. Importa como máximo ${max} cada vez.`,
    more: (n) => `+${n} más`,
    listedTwice: (n) => `${n} repetidas (omitidas)`,
    line: (n) => `Línea ${n}`,
    sameAs: (n) => `(igual que la línea ${n})`,
    cantRead: (n) => (n === 1 ? '1 no se puede leer' : `${n} no se pueden leer`),
    importing: 'Importando…',
    importN: (n) => (n === 1 ? 'Importar 1 palabra' : `Importar ${n} palabras`),
    import: 'Importar',
  },
)

/** Same cap as the API (SuggestSchema). */
const SUGGEST_MAX = 50

const PREVIEW_LIMIT = 8

type Tab = 'suggest' | 'import'
type TabProps = { deckId: string; sourceLang: LanguageCode; targetLang: LanguageCode; tabs: ReactNode }

export function AddWords() {
  const { deck } = useCurrentDeck()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'import' ? 'import' : 'suggest')
  if (!deck) return <Navigate to="/" replace />
  const props = { deckId: deck.id, sourceLang: deck.sourceLang as LanguageCode, targetLang: deck.targetLang as LanguageCode, tabs: <Tabs tab={tab} onChange={setTab} /> }
  return tab === 'suggest' ? <SuggestTab key={deck.id} {...props} /> : <ImportTab key={deck.id} {...props} />
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const m = useT(M)
  const items: { id: Tab; label: string }[] = [
    { id: 'suggest', label: m.tabSuggest },
    { id: 'import', label: m.tabImport },
  ]
  return (
    <div role="tablist" className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onChange(t.id)}
          className={`min-h-11 flex-1 rounded-lg py-2 text-center text-sm font-medium ${
            tab === t.id ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** Duplicates /generate found after the AI step (DUPLICATES.md 10.6 reason 'resolved'). */
function GenerationDuplicates({ targetLang }: { targetLang: LanguageCode }) {
  const t = useT(M)
  const ui = useUiLang()
  const { state } = useGeneration()
  if (state.duplicates.length === 0) return null
  return (
    <details className={`${card} text-sm`}>
      <summary className="cursor-pointer font-medium">{t.moreDuplicates(state.duplicates.length)}</summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {state.duplicates.map((d, i) => (
          <li key={i}>
            <Link className="underline decoration-zinc-300 underline-offset-2 dark:decoration-zinc-600" to={`/words/${d.existing.id}`}>
              {duplicateText(d, targetLang, ui)}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * "Learn them now" only makes sense while something is (or will be) ready to learn: words added
 * by this request can all turn out to be duplicates once they are prepared.
 */
function canLearn(result: { added: number }, stats: DeckStats | undefined): boolean {
  return result.added > 0 && (!stats || stats.new + stats.pending > 0)
}

const PRESETS = [5, 10, 20] as const

/** "Add new words" (M7): the next words of the frequency list (or AI picks), then generation. */
function SuggestTab({ deckId, targetLang, tabs }: TabProps) {
  const t = useT(M)
  const ui = useUiLang()
  const languageName = useLanguageName()
  const [preset, setPreset] = useState<number | 'custom'>(10)
  const [custom, setCustom] = useState('15')
  const [result, setResult] = useState<SuggestResponse | null>(null)
  const suggest = useSuggest(deckId)
  const generation = useGeneration()
  const stats = useDeckStats(deckId)
  const lang = LANGUAGES[targetLang]
  const langName = languageName(targetLang)

  const customCount = Number(custom)
  const count = preset === 'custom' ? customCount : preset
  const valid = Number.isInteger(count) && count >= 1 && count <= SUGGEST_MAX

  const submit = () =>
    suggest.mutate(count, {
      onSuccess: (r) => {
        setResult(r)
        if (r.pending > 0) generation.start({ fresh: true })
      },
    })

  if (result) {
    const nothing = result.added === 0
    return (
      <Screen title={t.title}>
        {nothing && result.exhausted ? (
          <section className={`${card} flex flex-col gap-2`} role="status">
            <p className="text-lg font-semibold">{t.noneLeft}</p>
            <p className={muted}>{t.exhausted}</p>
          </section>
        ) : nothing && result.duplicates.length === 0 ? (
          <section className={`${card} flex flex-col gap-2`} role="status">
            <p className="text-lg font-semibold">{t.noneFound}</p>
            <p className={muted}>{t.tryLater}</p>
          </section>
        ) : (
          <ImportSummary result={{ ...result, invalid: [] }} targetLang={targetLang} />
        )}
        {!nothing && result.exhausted && (
          <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900" role="status">
            {t.exhausted}
          </p>
        )}
        <GenerationBanner deckId={deckId} stats={stats.data} />
        <GenerationDuplicates targetLang={targetLang} />
        {canLearn(result, stats.data) && (
          <Link to="/learn" className={btnPrimary}>
            {t.learnNow}
          </Link>
        )}
        <Link to="/words" className={btnSecondary}>
          {t.seeWords}
        </Link>
        <button type="button" className={btnSecondary} onClick={() => setResult(null)}>
          {result.exhausted ? t.back : t.addMore}
        </button>
      </Screen>
    )
  }

  return (
    <Screen title={t.title}>
      {tabs}
      <p className={muted}>
        {lang.hasWordlist
          ? t.fromWordlist(langName)
          : t.fromAi(langName)}
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t.howMany}</legend>
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {[...PRESETS, 'custom' as const].map((p) => (
            <label
              key={p}
              className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg py-2 text-center text-sm font-medium ${
                preset === p ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <input type="radio" name="count" checked={preset === p} onChange={() => setPreset(p)} className="sr-only" />
              {p === 'custom' ? t.custom : p}
            </label>
          ))}
        </div>
        {preset === 'custom' && (
          <label className="flex items-center gap-2 text-sm">
            <span>{t.numberOfWords(SUGGEST_MAX)}</span>
            <input
              className={`${input} w-24`}
              type="number"
              inputMode="numeric"
              min={1}
              max={SUGGEST_MAX}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
        )}
      </fieldset>
      <GenerationBanner deckId={deckId} stats={stats.data} />
      <ErrorText error={isAiUnavailable(suggest.error) ? suggestUnavailableText(ui) : suggest.error} />
      <button type="button" className={btnPrimary} disabled={!valid || suggest.isPending} onClick={submit}>
        {suggest.isPending ? t.adding : valid ? t.addN(count) : t.add}
      </button>
    </Screen>
  )
}

function ImportTab({ deckId, sourceLang, targetLang, tabs }: TabProps) {
  const t = useT(M)
  const ui = useUiLang()
  const languageName = useLanguageName()
  const [text, setText] = useState('')
  const [filename, setFilename] = useState<string | undefined>()
  const [inputLang, setInputLang] = useState<InputLang>('target')
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)
  const importMutation = useImport(deckId)
  const generation = useGeneration()
  const stats = useDeckStats(deckId)

  const preview = useMemo(() => {
    const parsed = parseImport(text, { filename })
    const { unique, duplicates } = splitInFileDuplicates(keyRows(parsed.rows, { sourceLang, targetLang }, inputLang))
    return { parsed, unique, duplicates }
  }, [text, filename, inputLang, sourceLang, targetLang])

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileError(null)
    if (file.size > 1_000_000) {
      setFileError(t.fileTooLarge)
      return
    }
    try {
      setText(await file.text())
      setFilename(file.name)
    } catch {
      setFileError(t.fileUnreadable)
    }
  }

  const submit = () =>
    importMutation.mutate(
      { text, filename, inputLang },
      {
        onSuccess: (r) => {
          setResult(r)
          if (r.pending > 0) generation.start({ fresh: true })
        },
      },
    )

  if (result) {
    return (
      <Screen title={t.title}>
        <ImportSummary result={result} targetLang={targetLang} />
        <GenerationBanner deckId={deckId} stats={stats.data} />
        <GenerationDuplicates targetLang={targetLang} />
        {canLearn(result, stats.data) ? (
          <>
            <Link to="/learn" className={btnPrimary}>
              {t.learnNow}
            </Link>
            <Link to="/words" className={btnSecondary}>
              {t.seeWords}
            </Link>
          </>
        ) : (
          <Link to="/words" className={btnPrimary}>
            {t.seeWords}
          </Link>
        )}
        <button
          type="button"
          className={btnSecondary}
          onClick={() => {
            setResult(null)
            setText('')
            setFilename(undefined)
          }}
        >
          {t.importMore}
        </button>
      </Screen>
    )
  }

  const { parsed, unique, duplicates } = preview
  const langOptions: { value: InputLang; label: string }[] = [
    { value: 'target', label: languageName(targetLang) },
    { value: 'source', label: languageName(sourceLang) },
    { value: 'auto', label: t.auto },
  ]

  return (
    <Screen title={t.title}>
      {tabs}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.oneWordPerLine}</span>
        <textarea
          className={`${input} min-h-48 font-mono text-sm`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`${LANGUAGES[targetLang].importExample ?? t.placeholderFallback}\n${t.placeholderComment}`}
          spellCheck={false}
          autoCapitalize="off"
        />
      </label>
      <p className={muted}>{t.separatorHelp}</p>

      <div className="flex flex-wrap items-center gap-2">
        <label className={`${btnSmall} cursor-pointer`}>
          {t.chooseFile}
          <input type="file" accept=".txt,.csv,.tsv,text/plain,text/csv,text/tab-separated-values" className="sr-only" onChange={(e) => void onFile(e)} />
        </label>
        {filename && (
          <span className="flex items-center gap-2 text-sm">
            <span className="max-w-48 truncate">{filename}</span>
            <button type="button" className="text-zinc-500 underline" onClick={() => setFilename(undefined)}>
              {t.forget}
            </button>
          </span>
        )}
      </div>
      {fileError && <ErrorText error={fileError} />}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t.wordsAreIn}</legend>
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {langOptions.map((o) => (
            <label
              key={o.value}
              className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg py-2 text-center text-sm font-medium ${
                inputLang === o.value ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <input type="radio" name="inputLang" value={o.value} checked={inputLang === o.value} onChange={() => setInputLang(o.value)} className="sr-only" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      {parsed.dataLines > 0 && (
        <section className={`${card} flex flex-col gap-2 text-sm`} aria-live="polite" aria-label={t.preview}>
          <p className="text-base font-semibold">
            {t.toImport(unique.length)}
          </p>
          {parsed.headerLine !== null && <p className={muted}>{t.skippingHeader(parsed.headerLine)}</p>}
          {parsed.tooMany && (
            <p className="font-medium text-red-700 dark:text-red-400">
              {t.tooMany(parsed.dataLines, MAX_IMPORT_ROWS)}
            </p>
          )}
          {unique.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {unique.slice(0, PREVIEW_LIMIT).map((r) => (
                <li key={r.line} className="rounded-md bg-zinc-100 px-2 py-0.5 dark:bg-zinc-900">
                  {r.term}
                  {r.hint && <span className="text-zinc-500 dark:text-zinc-400"> · {r.hint}</span>}
                </li>
              ))}
              {unique.length > PREVIEW_LIMIT && <li className={muted}>{t.more(unique.length - PREVIEW_LIMIT)}</li>}
            </ul>
          )}
          {duplicates.length > 0 && (
            <details>
              <summary className="cursor-pointer">{t.listedTwice(duplicates.length)}</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {duplicates.map((d) => (
                  <li key={d.row.line}>
                    {t.line(d.row.line)}: {d.row.term} {t.sameAs(d.first.line)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {parsed.invalid.length > 0 && (
            <details>
              <summary className="cursor-pointer text-red-700 dark:text-red-400">{t.cantRead(parsed.invalid.length)}</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {parsed.invalid.map((r) => (
                  <li key={r.line} className="[overflow-wrap:anywhere]">
                    {t.line(r.line)}: {r.term ? `“${r.term}” ` : ''}({invalidReason(r, ui)})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <ErrorText error={importMutation.error} />
      <button type="button" className={btnPrimary} disabled={unique.length === 0 || parsed.tooMany || importMutation.isPending} onClick={submit}>
        {importMutation.isPending ? t.importing : unique.length > 0 ? t.importN(unique.length) : t.import}
      </button>
    </Screen>
  )
}
