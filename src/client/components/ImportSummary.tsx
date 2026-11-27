import { Link } from 'react-router'
import type { LanguageCode } from '../../shared/languages'
import type { ImportResponse } from '../../shared/schemas'
import { messages, useT, useUiLang } from '../lib/i18n'
import { duplicateText, invalidReason, summaryText } from '../lib/importCopy'
import { card, muted } from './ui'

const M = messages(
  {
    needsMeaning: 'Words the dictionary doesn\'t know show as “Needs meaning”: open them in Words to add the meaning.',
    already: (n: number) => `${n} already in your deck`,
    unreadable: (n: number) => `${n} couldn't be read`,
    line: (n: number) => `Line ${n}`,
  },
  {
    needsMeaning: 'Las palabras que el diccionario no conoce aparecen como “Falta el significado”: ábrelas en Palabras para añadirlo.',
    already: (n) => `${n} ya en tu mazo`,
    unreadable: (n) => (n === 1 ? '1 no se pudo leer' : `${n} no se pudieron leer`),
    line: (n) => `Línea ${n}`,
  },
)

export function ImportSummary({ result, targetLang }: { result: ImportResponse; targetLang: LanguageCode }) {
  const t = useT(M)
  const ui = useUiLang()
  return (
    <section className={`${card} flex flex-col gap-3`} role="status">
      <p className="text-lg font-semibold">{summaryText(result, ui)}</p>
      {result.pending > 0 && <p className={muted}>{t.needsMeaning}</p>}

      {result.duplicates.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">{t.already(result.duplicates.length)}</summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {result.duplicates.map((d, i) => (
              <li key={i}>
                <Link className="underline decoration-zinc-300 underline-offset-2 dark:decoration-zinc-600" to={`/words?q=${encodeURIComponent(d.existing.display)}&card=${d.existing.id}`}>
                  {duplicateText(d, targetLang, ui)}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.invalid.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">{t.unreadable(result.invalid.length)}</summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {result.invalid.map((r) => (
              <li key={r.line} className="[overflow-wrap:anywhere]">
                {t.line(r.line)}: {r.term ? `“${r.term}” ` : ''}({invalidReason(r, ui)})
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
