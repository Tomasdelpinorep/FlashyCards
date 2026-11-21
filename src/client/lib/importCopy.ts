/** Import summary copy (docs/DUPLICATES.md section 10.8). Pure, so it is unit-tested. */
import type { LanguageCode } from '../../shared/languages'
import { termKey } from '../../shared/normalize'
import type { DuplicateReport, ImportResponse, InvalidImportRow } from '../../shared/schemas'

const words = (n: number) => `${n} word${n === 1 ? '' : 's'}`

/** "Added 18 words · 3 already in your deck · 1 couldn't be read" (zero parts left out). */
export function summaryText(r: Pick<ImportResponse, 'added' | 'duplicates'> & { invalid?: ImportResponse['invalid'] }): string {
  const parts: string[] = []
  if (r.added > 0) parts.push(`Added ${words(r.added)}`)
  if (r.duplicates.length > 0) parts.push(`${r.duplicates.length} already in your deck`)
  if (r.invalid && r.invalid.length > 0) parts.push(`${r.invalid.length} couldn't be read`)
  return parts.length > 0 ? parts.join(' · ') : 'Nothing to import'
}

/** One line of the "already in your deck" list (docs/DUPLICATES.md section 10.8). */
export function duplicateText(d: DuplicateReport, targetLang: LanguageCode): string {
  if (d.reason === 'in_file') return `${d.input}${d.line ? ` (line ${d.line})` : ''}: listed twice in this import`
  const same = termKey(targetLang, d.input) === termKey(targetLang, d.existing.display)
  const name = same ? d.existing.display : `${d.input} → ${d.existing.display}`
  if (d.addedTranslation) return `${name}: already in your deck, added as a translation`
  if (d.existing.status === 'failed') return `${name}: already in your deck (generation failed, retry it from Words)`
  return `${name}: already in your deck`
}

export const invalidReason = (r: InvalidImportRow) => (r.reason === 'too_long' ? 'longer than 100 characters' : 'no word in the first column')
