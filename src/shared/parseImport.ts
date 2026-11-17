/**
 * Import text parsing (PLAN.md section 4) and the in-file duplicate step of
 * docs/DUPLICATES.md section 10.3. Shared by the Worker (POST /decks/:id/import) and the
 * client (live preview), so both always agree on what a file contains.
 */
import { LANGUAGE_CODES, LANGUAGES, type LanguageCode } from './languages'
import { collapseWhitespace, glossKey, termKey } from './normalize'

export const MAX_IMPORT_ROWS = 500
export const MAX_TERM_LENGTH = 100

export type InputLang = 'target' | 'source' | 'auto'

/** One importable line. `line` is the 1-based line number in the original text. */
export type ImportRow = { line: number; term: string; hint?: string }

export type InvalidReason = 'empty_term' | 'too_long'
export type InvalidRow = { line: number; term: string; reason: InvalidReason }

export type ParsedImport = {
  rows: ImportRow[]
  invalid: InvalidRow[]
  /** Line number of the skipped header row, if one was detected. */
  headerLine: number | null
  /** Data lines (rows + invalid); more than MAX_IMPORT_ROWS is rejected by the API. */
  dataLines: number
  tooMany: boolean
}

const BASE_DELIMITERS = ['\t', ';', '|'] as const

/** Header words in every language, plus the language names and codes themselves. */
const HEADER_WORDS: ReadonlySet<string> = new Set(
  LANGUAGE_CODES.flatMap((code) => [code, LANGUAGES[code].name.toLowerCase(), ...LANGUAGES[code].importHeaderWords]),
)

function isSpreadsheetFile(filename: string | undefined): { csv: boolean; table: boolean } {
  const ext = filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return { csv: ext === 'csv', table: ext === 'csv' || ext === 'tsv' }
}

/** Split one line on `delimiter`, honouring "double-quoted" fields with "" escapes. */
export function splitFields(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let i = 0
  for (;;) {
    while (line[i] === ' ' && delimiter !== ' ') i++
    let field = ''
    if (line[i] === '"') {
      i++
      for (;;) {
        if (i >= line.length) break
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            field += '"'
            i += 2
            continue
          }
          i++
          break
        }
        field += line[i++]
      }
      // Anything between the closing quote and the next delimiter is kept verbatim.
      const next = line.indexOf(delimiter, i)
      field += next === -1 ? line.slice(i) : line.slice(i, next)
      i = next === -1 ? line.length : next
    } else {
      const next = line.indexOf(delimiter, i)
      field = next === -1 ? line.slice(i) : line.slice(i, next)
      i = next === -1 ? line.length : next
    }
    fields.push(field)
    if (i >= line.length) break
    i += delimiter.length
    if (i >= line.length) {
      fields.push('')
      break
    }
  }
  return fields
}

function clean(s: string | undefined): string {
  return collapseWhitespace((s ?? '').normalize('NFC'))
}

/**
 * Parse pasted text or a .txt/.csv/.tsv file:
 * - one entry per line; blank lines and lines starting with `#` are skipped
 * - delimiter per line: tab, then `;`, then `|`; `,` only for .csv files
 * - column 1 is the term, column 2 an optional hint/translation, further columns are ignored
 * - the first data line is skipped as a header when every column is a known header word
 *   ("German;English", "term,translation"); a single-column header only in .csv/.tsv files
 * - a term or hint longer than 100 characters, or an empty term, is reported as invalid
 */
export function parseImport(text: string, options: { filename?: string } = {}): ParsedImport {
  const { csv, table } = isSpreadsheetFile(options.filename)
  const delimiters: readonly string[] = csv ? [...BASE_DELIMITERS, ','] : BASE_DELIMITERS
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)

  const rows: ImportRow[] = []
  const invalid: InvalidRow[] = []
  let headerLine: number | null = null
  let seenData = false

  lines.forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return

    const delimiter = delimiters.find((d) => trimmed.includes(d))
    const fields = (delimiter ? splitFields(trimmed, delimiter) : [trimmed]).map(clean)
    const [term = '', hint = ''] = fields

    if (!seenData) {
      seenData = true
      const nonEmpty = fields.filter(Boolean)
      const allHeader = nonEmpty.length > 0 && nonEmpty.every((f) => HEADER_WORDS.has(f.toLowerCase().replace(/:$/, '')))
      if (allHeader && (nonEmpty.length >= 2 || table)) {
        headerLine = line
        return
      }
    }

    if (term === '') invalid.push({ line, term: hint, reason: 'empty_term' })
    else if (term.length > MAX_TERM_LENGTH || hint.length > MAX_TERM_LENGTH) {
      invalid.push({ line, term: term.slice(0, MAX_TERM_LENGTH), reason: 'too_long' })
    } else rows.push(hint ? { line, term, hint } : { line, term })
  })

  const dataLines = rows.length + invalid.length
  return { rows, invalid, headerLine, dataLines, tooMany: dataLines > MAX_IMPORT_ROWS }
}

// ---------- keys and in-file duplicates (DUPLICATES.md section 10.3, step 1) ----------

export type LanguagePair = { sourceLang: LanguageCode; targetLang: LanguageCode }

export type KeyedRow = ImportRow & { lang: InputLang; termKey: string; hintKey: string }

/**
 * term_key of an input term. For 'auto' the side is unknown, so the articles of both
 * languages are stripped ("der Hund" and "the dog" both lose their article).
 */
export function inputTermKey(pair: LanguagePair, lang: InputLang, term: string): string {
  if (lang === 'target') return termKey(pair.targetLang, term)
  if (lang === 'source') return termKey(pair.sourceLang, term)
  return termKey(pair.targetLang, termKey(pair.sourceLang, term))
}

/** hint_key: glossKey(source_lang, hint), or '' without a hint. */
export function hintKeyOf(pair: LanguagePair, hint: string | null | undefined): string {
  return hint ? glossKey(pair.sourceLang, hint) : ''
}

export function keyRows(rows: readonly ImportRow[], pair: LanguagePair, lang: InputLang): KeyedRow[] {
  return rows.map((r) => ({ ...r, lang, termKey: inputTermKey(pair, lang, r.term), hintKey: hintKeyOf(pair, r.hint) }))
}

export function compatLang(a: InputLang, b: InputLang): boolean {
  return a === b || a === 'auto' || b === 'auto'
}

export type InFileDuplicate = { row: KeyedRow; first: KeyedRow }

/**
 * Drop row r when an earlier kept row s has a compatible input language, the same term key,
 * and r has no hint or the same hint key. "der Hund\nHund" -> line 2 is a duplicate of line 1;
 * "Bank;bench\nBank;bank" keeps both.
 */
export function splitInFileDuplicates(rows: readonly KeyedRow[]): { unique: KeyedRow[]; duplicates: InFileDuplicate[] } {
  const unique: KeyedRow[] = []
  const duplicates: InFileDuplicate[] = []
  const byTermKey = new Map<string, KeyedRow[]>()
  for (const r of rows) {
    const earlier = byTermKey.get(r.termKey) ?? []
    const first = earlier.find((s) => compatLang(s.lang, r.lang) && (r.hintKey === '' || r.hintKey === s.hintKey))
    if (first) {
      duplicates.push({ row: r, first })
      continue
    }
    unique.push(r)
    earlier.push(r)
    byTermKey.set(r.termKey, earlier)
  }
  return { unique, duplicates }
}
