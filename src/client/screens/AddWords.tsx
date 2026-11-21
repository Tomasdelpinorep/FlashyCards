import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { LANGUAGES, type LanguageCode } from '../../shared/languages'
import {
  keyRows,
  MAX_IMPORT_ROWS,
  parseImport,
  splitInFileDuplicates,
  type InputLang,
} from '../../shared/parseImport'
import type { ImportResponse, SuggestResponse } from '../../shared/schemas'
import { GenerationBanner } from '../components/GenerationBanner'
import { ImportSummary } from '../components/ImportSummary'
import { btnPrimary, btnSecondary, btnSmall, card, ErrorText, input, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useGeneration } from '../lib/generation'
import { duplicateText, invalidReason } from '../lib/importCopy'
import { useDeckStats, useImport, useSuggest } from '../lib/queries'

/** Same cap as the API (SuggestSchema). */
const SUGGEST_MAX = 50

const PREVIEW_LIMIT = 8

type Tab = 'suggest' | 'import'
type TabProps = { deckId: string; sourceLang: LanguageCode; targetLang: LanguageCode; tabs: ReactNode }

export function AddWords() {
  const { deck } = useCurrentDeck()
  const [tab, setTab] = useState<Tab>('suggest')
  if (!deck) return <Navigate to="/" replace />
  const props = { deckId: deck.id, sourceLang: deck.sourceLang as LanguageCode, targetLang: deck.targetLang as LanguageCode, tabs: <Tabs tab={tab} onChange={setTab} /> }
  return tab === 'suggest' ? <SuggestTab key={deck.id} {...props} /> : <ImportTab key={deck.id} {...props} />
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: 'suggest', label: 'Add new words' },
    { id: 'import', label: 'Import' },
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
          className={`flex-1 rounded-lg py-2 text-center text-sm font-medium ${
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
  const { state } = useGeneration()
  if (state.duplicates.length === 0) return null
  return (
    <details className={`${card} text-sm`}>
      <summary className="cursor-pointer font-medium">{state.duplicates.length} more already in your deck (found while preparing)</summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {state.duplicates.map((d, i) => (
          <li key={i}>
            <Link className="underline decoration-zinc-300 underline-offset-2 dark:decoration-zinc-600" to={`/words/${d.existing.id}`}>
              {duplicateText(d, targetLang)}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}

const PRESETS = [5, 10, 20] as const

/** "Add new words" (M7): the next words of the frequency list (or AI picks), then generation. */
function SuggestTab({ deckId, targetLang, tabs }: TabProps) {
  const [preset, setPreset] = useState<number | 'custom'>(10)
  const [custom, setCustom] = useState('15')
  const [result, setResult] = useState<SuggestResponse | null>(null)
  const suggest = useSuggest(deckId)
  const generation = useGeneration()
  const stats = useDeckStats(deckId)
  const lang = LANGUAGES[targetLang]

  const customCount = Number(custom)
  const count = preset === 'custom' ? customCount : preset
  const valid = Number.isInteger(count) && count >= 1 && count <= SUGGEST_MAX

  const submit = () =>
    suggest.mutate(count, {
      onSuccess: (r) => {
        setResult(r)
        if (r.pending > 0) generation.start()
      },
    })

  if (result) {
    const nothing = result.added === 0
    return (
      <Screen title="Add words">
        {nothing && result.exhausted ? (
          <section className={`${card} flex flex-col gap-2`} role="status">
            <p className="text-lg font-semibold">No new words left</p>
            <p className={muted}>You already have every word in the {lang.name} word list. Import your own words to keep going.</p>
          </section>
        ) : nothing && result.duplicates.length === 0 ? (
          <section className={`${card} flex flex-col gap-2`} role="status">
            <p className="text-lg font-semibold">No new words found</p>
            <p className={muted}>Try again in a moment, or import your own words.</p>
          </section>
        ) : (
          <ImportSummary result={{ ...result, invalid: [] }} targetLang={targetLang} />
        )}
        {!nothing && result.exhausted && (
          <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900" role="status">
            That was the end of the {lang.name} word list: there are no more new words to suggest.
          </p>
        )}
        <GenerationBanner deckId={deckId} stats={stats.data} />
        <GenerationDuplicates targetLang={targetLang} />
        {result.added > 0 && (
          <Link to="/learn" className={btnPrimary}>
            Learn them now
          </Link>
        )}
        <Link to="/words" className={btnSecondary}>
          See your words
        </Link>
        <button type="button" className={btnSecondary} onClick={() => setResult(null)}>
          {result.exhausted ? 'Back' : 'Add more'}
        </button>
      </Screen>
    )
  }

  return (
    <Screen title="Add words">
      {tabs}
      <p className={muted}>
        {lang.hasWordlist
          ? `Adds the most common ${lang.name} words you don't have yet, in order of frequency.`
          : `Common ${lang.name} words you don't have yet, picked by AI (there is no bundled word list for ${lang.name}).`}
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">How many words?</legend>
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {[...PRESETS, 'custom' as const].map((p) => (
            <label
              key={p}
              className={`flex-1 cursor-pointer rounded-lg py-2 text-center text-sm font-medium ${
                preset === p ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <input type="radio" name="count" checked={preset === p} onChange={() => setPreset(p)} className="sr-only" />
              {p === 'custom' ? 'Custom' : p}
            </label>
          ))}
        </div>
        {preset === 'custom' && (
          <label className="flex items-center gap-2 text-sm">
            <span>Number of words (1–{SUGGEST_MAX})</span>
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
      <ErrorText error={suggest.error} />
      <button type="button" className={btnPrimary} disabled={!valid || suggest.isPending} onClick={submit}>
        {suggest.isPending ? 'Adding…' : valid ? `Add ${count} word${count === 1 ? '' : 's'}` : 'Add'}
      </button>
    </Screen>
  )
}

function ImportTab({ deckId, sourceLang, targetLang, tabs }: TabProps) {
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
      setFileError('That file is too large (max 1 MB).')
      return
    }
    try {
      setText(await file.text())
      setFilename(file.name)
    } catch {
      setFileError("Couldn't read that file.")
    }
  }

  const submit = () =>
    importMutation.mutate(
      { text, filename, inputLang },
      {
        onSuccess: (r) => {
          setResult(r)
          if (r.pending > 0) generation.start()
        },
      },
    )

  if (result) {
    return (
      <Screen title="Add words">
        <ImportSummary result={result} targetLang={targetLang} />
        <GenerationBanner deckId={deckId} stats={stats.data} />
        <GenerationDuplicates targetLang={targetLang} />
        {result.added > 0 ? (
          <>
            <Link to="/learn" className={btnPrimary}>
              Learn them now
            </Link>
            <Link to="/words" className={btnSecondary}>
              See your words
            </Link>
          </>
        ) : (
          <Link to="/words" className={btnPrimary}>
            See your words
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
          Import more
        </button>
      </Screen>
    )
  }

  const { parsed, unique, duplicates } = preview
  const langOptions: { value: InputLang; label: string }[] = [
    { value: 'target', label: LANGUAGES[targetLang].name },
    { value: 'source', label: LANGUAGES[sourceLang].name },
    { value: 'auto', label: 'Auto' },
  ]

  return (
    <Screen title="Add words">
      {tabs}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">One word per line</span>
        <textarea
          className={`${input} min-h-48 font-mono text-sm`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'der Hund\nKatze;cat\ngehen\n# lines starting with # are ignored'}
          spellCheck={false}
          autoCapitalize="off"
        />
      </label>
      <p className={muted}>Add a meaning or translation after a tab, “;” or “|”, e.g. “Bank;bench”.</p>

      <div className="flex flex-wrap items-center gap-2">
        <label className={`${btnSmall} cursor-pointer`}>
          Choose file…
          <input type="file" accept=".txt,.csv,.tsv,text/plain,text/csv,text/tab-separated-values" className="sr-only" onChange={(e) => void onFile(e)} />
        </label>
        {filename && (
          <span className="flex items-center gap-2 text-sm">
            <span className="max-w-48 truncate">{filename}</span>
            <button type="button" className="text-zinc-500 underline" onClick={() => setFilename(undefined)}>
              forget
            </button>
          </span>
        )}
      </div>
      {fileError && <ErrorText error={fileError} />}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">The words are in</legend>
        <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {langOptions.map((o) => (
            <label
              key={o.value}
              className={`flex-1 cursor-pointer rounded-lg py-2 text-center text-sm font-medium ${
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
        <section className={`${card} flex flex-col gap-2 text-sm`} aria-live="polite" aria-label="Preview">
          <p className="text-base font-semibold">
            {unique.length} word{unique.length === 1 ? '' : 's'} to import
          </p>
          {parsed.headerLine !== null && <p className={muted}>Skipping the header row (line {parsed.headerLine}).</p>}
          {parsed.tooMany && (
            <p className="font-medium text-red-700 dark:text-red-400">
              This list has {parsed.dataLines} rows. Import at most {MAX_IMPORT_ROWS} at a time.
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
              {unique.length > PREVIEW_LIMIT && <li className={muted}>+{unique.length - PREVIEW_LIMIT} more</li>}
            </ul>
          )}
          {duplicates.length > 0 && (
            <details>
              <summary className="cursor-pointer">{duplicates.length} listed twice (skipped)</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {duplicates.map((d) => (
                  <li key={d.row.line}>
                    Line {d.row.line}: {d.row.term} (same as line {d.first.line})
                  </li>
                ))}
              </ul>
            </details>
          )}
          {parsed.invalid.length > 0 && (
            <details>
              <summary className="cursor-pointer text-red-700 dark:text-red-400">{parsed.invalid.length} can't be read</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {parsed.invalid.map((r) => (
                  <li key={r.line}>
                    Line {r.line}: {r.term ? `“${r.term}” ` : ''}({invalidReason(r)})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <ErrorText error={importMutation.error} />
      <button type="button" className={btnPrimary} disabled={unique.length === 0 || parsed.tooMany || importMutation.isPending} onClick={submit}>
        {importMutation.isPending ? 'Importing…' : unique.length > 0 ? `Import ${unique.length} word${unique.length === 1 ? '' : 's'}` : 'Import'}
      </button>
    </Screen>
  )
}
