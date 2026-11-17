import { describe, expect, it } from 'vitest'
import {
  inputTermKey,
  keyRows,
  MAX_IMPORT_ROWS,
  parseImport,
  splitFields,
  splitInFileDuplicates,
  type LanguagePair,
} from '../../src/shared/parseImport'

const PAIR: LanguagePair = { sourceLang: 'en', targetLang: 'de' }

describe('parseImport', () => {
  it('skips comments and blank lines and keeps line numbers', () => {
    const p = parseImport('der Hund\nHund\nKatze;cat\n# comment\n\ngehen')
    expect(p.rows).toEqual([
      { line: 1, term: 'der Hund' },
      { line: 2, term: 'Hund' },
      { line: 3, term: 'Katze', hint: 'cat' },
      { line: 6, term: 'gehen' },
    ])
    expect(p.invalid).toEqual([])
    expect(p.dataLines).toBe(4)
    expect(p.headerLine).toBeNull()
  })

  it('handles CRLF, CR, a BOM and indented comments', () => {
    const p = parseImport('﻿Hund\r\n  # note\r\nKatze\rMaus')
    expect(p.rows.map((r) => [r.line, r.term])).toEqual([
      [1, 'Hund'],
      [3, 'Katze'],
      [4, 'Maus'],
    ])
  })

  it('splits on tab, ; and | and ignores extra columns', () => {
    const p = parseImport('Hund\tdog\nKatze ; cat\nMaus|mouse|extra\nBaum;')
    expect(p.rows).toEqual([
      { line: 1, term: 'Hund', hint: 'dog' },
      { line: 2, term: 'Katze', hint: 'cat' },
      { line: 3, term: 'Maus', hint: 'mouse' },
      { line: 4, term: 'Baum' },
    ])
  })

  it('prefers tab over ; over |', () => {
    expect(parseImport('a;b\tc').rows[0]).toEqual({ line: 1, term: 'a;b', hint: 'c' })
    expect(parseImport('a|b;c').rows[0]).toEqual({ line: 1, term: 'a|b', hint: 'c' })
  })

  it('splits on comma only for .csv files', () => {
    expect(parseImport('Hund, -e').rows[0]).toEqual({ line: 1, term: 'Hund, -e' })
    expect(parseImport('Hund,dog', { filename: 'words.txt' }).rows[0]).toEqual({ line: 1, term: 'Hund,dog' })
    expect(parseImport('Hund,dog', { filename: 'Words.CSV' }).rows[0]).toEqual({ line: 1, term: 'Hund', hint: 'dog' })
    // A .csv that uses semicolons still works.
    expect(parseImport('Hund;dog, hound', { filename: 'w.csv' }).rows[0]).toEqual({ line: 1, term: 'Hund', hint: 'dog, hound' })
  })

  it('honours quoted CSV fields', () => {
    const p = parseImport('"Hund, -e","dog"\n"sagen","to say ""hi"""', { filename: 'w.csv' })
    expect(p.rows).toEqual([
      { line: 1, term: 'Hund, -e', hint: 'dog' },
      { line: 2, term: 'sagen', hint: 'to say "hi"' },
    ])
  })

  it('skips a header row', () => {
    expect(parseImport('German;English\nHund;dog').rows).toEqual([{ line: 2, term: 'Hund', hint: 'dog' }])
    expect(parseImport('German;English\nHund;dog').headerLine).toBe(1)
    expect(parseImport('# my list\n\nWort\tÜbersetzung\nHund\tdog').rows).toEqual([{ line: 4, term: 'Hund', hint: 'dog' }])
    expect(parseImport('term,translation\nHund,dog', { filename: 'a.csv' }).rows).toHaveLength(1)
    expect(parseImport('word\nHund', { filename: 'a.csv' }).rows).toEqual([{ line: 2, term: 'Hund' }])
  })

  it('does not treat a real first word as a header', () => {
    // A single word in a pasted list is data, even if it looks like a header word.
    expect(parseImport('Wort\nHund').rows).toHaveLength(2)
    expect(parseImport('Hund;dog\nGerman;English').rows).toHaveLength(2)
    expect(parseImport('Deutsch;language').rows).toHaveLength(1)
  })

  it('reports terms over 100 characters and empty terms as invalid', () => {
    const long = 'x'.repeat(101)
    const p = parseImport(`${'y'.repeat(100)}\n${long}\n;dog\nHund;${long}`)
    expect(p.rows).toEqual([{ line: 1, term: 'y'.repeat(100) }])
    expect(p.invalid).toEqual([
      { line: 2, term: 'x'.repeat(100), reason: 'too_long' },
      { line: 3, term: 'dog', reason: 'empty_term' },
      { line: 4, term: 'Hund', reason: 'too_long' },
    ])
  })

  it('normalizes whitespace and NFC in fields', () => {
    expect(parseImport('  der   Mädchen \t  girl  ').rows[0]).toEqual({ line: 1, term: 'der Mädchen', hint: 'girl' })
  })

  it('flags more than 500 data lines', () => {
    const ok = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `w${i}`).join('\n')
    expect(parseImport(`# header comment\n${ok}\n\n`).tooMany).toBe(false)
    const p = parseImport(`${ok}\nextra`)
    expect(p.dataLines).toBe(501)
    expect(p.tooMany).toBe(true)
  })

  it('returns nothing for empty input', () => {
    expect(parseImport('')).toMatchObject({ rows: [], invalid: [], dataLines: 0, tooMany: false })
    expect(parseImport('\n  \n# only comments')).toMatchObject({ rows: [], dataLines: 0 })
  })
})

describe('splitFields', () => {
  it('splits and keeps empty fields', () => {
    expect(splitFields('a;;b;', ';')).toEqual(['a', '', 'b', ''])
    expect(splitFields('"a;b";c', ';')).toEqual(['a;b', 'c'])
  })
})

describe('keys and in-file duplicates', () => {
  it('computes term and hint keys per input language', () => {
    expect(inputTermKey(PAIR, 'target', 'der Hund, -e')).toBe('hund')
    expect(inputTermKey(PAIR, 'source', 'the dog')).toBe('dog')
    expect(inputTermKey(PAIR, 'source', 'der Hund')).toBe('der hund')
    expect(inputTermKey(PAIR, 'auto', 'der Hund')).toBe('hund')
    expect(inputTermKey(PAIR, 'auto', 'the dog')).toBe('dog')
    const [row] = keyRows([{ line: 1, term: 'Bank', hint: 'to Bench (seat)' }], PAIR, 'target')
    expect(row).toMatchObject({ termKey: 'bank', hintKey: 'bench', lang: 'target' })
  })

  it('finds the in-file duplicate of the acceptance example', () => {
    const rows = keyRows(parseImport('der Hund\nHund\nKatze;cat\n# comment\n\ngehen').rows, PAIR, 'target')
    const { unique, duplicates } = splitInFileDuplicates(rows)
    expect(unique.map((r) => r.line)).toEqual([1, 3, 6])
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]!.row.line).toBe(2)
    expect(duplicates[0]!.first.line).toBe(1)
  })

  it('keeps different hints, drops a hintless repeat and a same-hint repeat', () => {
    const rows = keyRows(parseImport('Bank;bench\nBank;bank\nBank\nBank;Bench\nBank;the bank').rows, PAIR, 'target')
    const { unique, duplicates } = splitInFileDuplicates(rows)
    expect(unique.map((r) => r.line)).toEqual([1, 2])
    expect(duplicates.map((d) => [d.row.line, d.first.line])).toEqual([
      [3, 1],
      [4, 1],
      [5, 2],
    ])
  })

  it('keeps a hinted row after a hintless one (resolved later, DUPLICATES 10.1)', () => {
    const rows = keyRows(parseImport('Bank\nBank;bench').rows, PAIR, 'target')
    expect(splitInFileDuplicates(rows).unique).toHaveLength(2)
  })
})
