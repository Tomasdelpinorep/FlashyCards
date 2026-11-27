/** Import summary copy (docs/DUPLICATES.md section 10.8). Pure, so it is unit-tested. */
import type { LanguageCode, UiLanguage } from '../../shared/languages'
import { termKey } from '../../shared/normalize'
import type { DuplicateReport, ImportResponse, InvalidImportRow } from '../../shared/schemas'

const COPY = {
  en: {
    added: (n: number) => `Added ${n} word${n === 1 ? '' : 's'}`,
    already: (n: number) => `${n} already in your deck`,
    unreadable: (n: number) => `${n} couldn't be read`,
    nothing: 'Nothing to import',
    inFile: (input: string, line: string) => `${input}${line ? ` (line ${line})` : ''}: listed twice in this import`,
    asTranslation: (name: string) => `${name}: already in your deck, added as a translation`,
    needsMeaning: (name: string) => `${name}: already in your deck (needs a meaning, add it in Words)`,
    inDeck: (name: string) => `${name}: already in your deck`,
    tooLong: 'longer than 100 characters',
    noWord: 'no word in the first column',
  },
  es: {
    added: (n: number) => (n === 1 ? 'Añadida 1 palabra' : `Añadidas ${n} palabras`),
    already: (n: number) => `${n} ya en tu mazo`,
    unreadable: (n: number) => (n === 1 ? '1 no se pudo leer' : `${n} no se pudieron leer`),
    nothing: 'Nada que importar',
    inFile: (input: string, line: string) => `${input}${line ? ` (línea ${line})` : ''}: aparece dos veces en esta importación`,
    asTranslation: (name: string) => `${name}: ya está en tu mazo, añadida como traducción`,
    needsMeaning: (name: string) => `${name}: ya está en tu mazo (falta el significado, añádelo en Palabras)`,
    inDeck: (name: string) => `${name}: ya está en tu mazo`,
    tooLong: 'más de 100 caracteres',
    noWord: 'no hay ninguna palabra en la primera columna',
  },
} as const

/** "Added 18 words · 3 already in your deck · 1 couldn't be read" (zero parts left out). */
export function summaryText(
  r: Pick<ImportResponse, 'added' | 'duplicates'> & { invalid?: ImportResponse['invalid'] },
  ui: UiLanguage = 'en',
): string {
  const c = COPY[ui]
  const parts: string[] = []
  if (r.added > 0) parts.push(c.added(r.added))
  if (r.duplicates.length > 0) parts.push(c.already(r.duplicates.length))
  if (r.invalid && r.invalid.length > 0) parts.push(c.unreadable(r.invalid.length))
  return parts.length > 0 ? parts.join(' · ') : c.nothing
}

/** One line of the "already in your deck" list (docs/DUPLICATES.md section 10.8). */
export function duplicateText(d: DuplicateReport, targetLang: LanguageCode, ui: UiLanguage = 'en'): string {
  const c = COPY[ui]
  if (d.reason === 'in_file') return c.inFile(d.input, d.line ? String(d.line) : '')
  const same = termKey(targetLang, d.input) === termKey(targetLang, d.existing.display)
  const name = same ? d.existing.display : `${d.input} → ${d.existing.display}`
  if (d.addedTranslation) return c.asTranslation(name)
  if (d.existing.status === 'failed') return c.needsMeaning(name)
  return c.inDeck(name)
}

export const invalidReason = (r: InvalidImportRow, ui: UiLanguage = 'en') => (r.reason === 'too_long' ? COPY[ui].tooLong : COPY[ui].noWord)
