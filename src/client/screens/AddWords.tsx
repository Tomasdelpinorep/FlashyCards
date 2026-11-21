import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { LANGUAGES, type LanguageCode } from '../../shared/languages'
import {
  keyRows,
  MAX_IMPORT_ROWS,
  parseImport,
  splitInFileDuplicates,
  type InputLang,
} from '../../shared/parseImport'
import type { ImportResponse } from '../../shared/schemas'
import { GenerationBanner } from '../components/GenerationBanner'
import { ImportSummary } from '../components/ImportSummary'
import { btnPrimary, btnSecondary, btnSmall, card, ErrorText, input, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useGeneration } from '../lib/generation'
import { duplicateText, invalidReason } from '../lib/importCopy'
import { useDeckStats, useImport } from '../lib/queries'

const PREVIEW_LIMIT = 8

export function AddWords() {
  const { deck } = useCurrentDeck()
  if (!deck) return <Navigate to="/" replace />
  return <ImportTab key={deck.id} deckId={deck.id} sourceLang={deck.sourceLang as LanguageCode} targetLang={deck.targetLang as LanguageCode} />
}

function ImportTab({ deckId, sourceLang, targetLang }: { deckId: string; sourceLang: LanguageCode; targetLang: LanguageCode }) {
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
        {generation.state.duplicates.length > 0 && (
          <details className={`${card} text-sm`}>
            <summary className="cursor-pointer font-medium">
              {generation.state.duplicates.length} more already in your deck (found while preparing)
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {generation.state.duplicates.map((d, i) => (
                <li key={i}>
                  <Link className="underline decoration-zinc-300 underline-offset-2 dark:decoration-zinc-600" to={`/words/${d.existing.id}`}>
                    {duplicateText(d, targetLang)}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
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
      <div role="tablist" className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
        <span role="tab" aria-selected="true" className="flex-1 rounded-lg bg-white py-2 text-center text-sm font-medium shadow-sm dark:bg-zinc-800">
          Import
        </span>
      </div>

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
