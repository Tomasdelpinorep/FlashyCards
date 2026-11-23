import { describe, expect, it } from 'vitest'
import { duplicateText, summaryText } from '../../src/client/lib/importCopy'
import type { DuplicateReport, ImportResponse } from '../../src/shared/schemas'

const dup = (d: Partial<DuplicateReport>): DuplicateReport => ({
  input: 'Hund',
  reason: 'in_deck',
  existing: { id: 'c1', display: 'der Hund', status: 'ready' },
  addedTranslation: null,
  ...d,
})

describe('import summary copy (DUPLICATES 10.8)', () => {
  it('joins the non-zero parts', () => {
    const r = (added: number, dups: number, invalid: number): ImportResponse => ({
      added,
      ready: 0,
      pending: added,
      duplicates: Array.from({ length: dups }, () => dup({})),
      invalid: Array.from({ length: invalid }, (_, i) => ({ line: i + 1, term: 'x', reason: 'too_long' as const })),
    })
    expect(summaryText(r(18, 3, 1))).toBe("Added 18 words · 3 already in your deck · 1 couldn't be read")
    expect(summaryText(r(1, 0, 0))).toBe('Added 1 word')
    expect(summaryText(r(0, 2, 0))).toBe('2 already in your deck')
    expect(summaryText(r(0, 0, 0))).toBe('Nothing to import')
  })

  it('words each duplicate line', () => {
    expect(duplicateText(dup({ input: 'large', existing: { id: 'c', display: 'groß', status: 'ready' }, addedTranslation: 'large' }), 'de')).toBe(
      'large → groß: already in your deck, added as a translation',
    )
    expect(duplicateText(dup({}), 'de')).toBe('der Hund: already in your deck')
    expect(duplicateText(dup({ reason: 'in_file', line: 7 }), 'de')).toBe('Hund (line 7): listed twice in this import')
    expect(duplicateText(dup({ input: 'Katze', existing: { id: 'c', display: 'Katze', status: 'failed' } }), 'de')).toBe(
      "Katze: already in your deck (needs a meaning, add it in Words)",
    )
  })
})
