import { Link } from 'react-router'
import type { LanguageCode } from '../../shared/languages'
import type { ImportResponse } from '../../shared/schemas'
import { duplicateText, invalidReason, summaryText } from '../lib/importCopy'
import { card, muted } from './ui'

export function ImportSummary({ result, targetLang }: { result: ImportResponse; targetLang: LanguageCode }) {
  return (
    <section className={`${card} flex flex-col gap-3`} role="status">
      <p className="text-lg font-semibold">{summaryText(result)}</p>
      {result.pending > 0 && <p className={muted}>New words show as “Preparing…” until their example sentences are ready.</p>}

      {result.duplicates.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">{result.duplicates.length} already in your deck</summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {result.duplicates.map((d, i) => (
              <li key={i}>
                <Link className="underline decoration-zinc-300 underline-offset-2 dark:decoration-zinc-600" to={`/words?q=${encodeURIComponent(d.existing.display)}&card=${d.existing.id}`}>
                  {duplicateText(d, targetLang)}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.invalid.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">{result.invalid.length} couldn't be read</summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {result.invalid.map((r) => (
              <li key={r.line} className="[overflow-wrap:anywhere]">
                Line {r.line}: {r.term ? `“${r.term}” ` : ''}({invalidReason(r)})
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
