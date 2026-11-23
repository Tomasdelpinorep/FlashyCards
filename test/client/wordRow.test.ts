import { describe, expect, it } from 'vitest'
import { STATUS_BADGE, wordRowText } from '../../src/client/lib/wordRow'

const base = {
  status: 'ready' as const,
  display: 'der Hund',
  inputTerm: 'Hund',
  inputHint: null,
  translation: 'dog',
  extraTranslations: [] as string[],
  genError: null,
}

describe('wordRowText', () => {
  it('a duplicate shows what the user typed, not the word it resolved to (e2e bug: two "der Hund" rows)', () => {
    const dup = { ...base, status: 'duplicate' as const, inputTerm: 'pooch', duplicateOf: { id: 'h', display: 'der Hund' } }
    expect(wordRowText(dup)).toEqual({ title: 'pooch', hint: null, subtitle: 'Already in your deck as der Hund' })
    expect(wordRowText({ ...dup, inputTerm: 'Bank', inputHint: 'Bench' }).hint).toBe('Bench')
  })
  it('ready, pending and failed rows', () => {
    expect(wordRowText({ ...base, extraTranslations: ['pooch'] })).toEqual({ title: 'der Hund', hint: null, subtitle: 'dog · also: pooch' })
    expect(wordRowText({ ...base, status: 'pending', display: 'Katze', inputHint: 'cat', translation: null })).toEqual({
      title: 'Katze',
      hint: 'cat',
      subtitle: 'Preparing…',
    })
    expect(wordRowText({ ...base, status: 'failed', genError: 'needs_meaning' }).subtitle).toBe('Not in the dictionary · add its meaning')
    expect(wordRowText({ ...base, status: 'failed', genError: 'not_a_word' }).subtitle).toBe('Not recognised as a word · add its meaning')
    expect(wordRowText({ ...base, status: 'failed', genError: 'boom' }).subtitle).toBe("Couldn't be looked up · retry or add its meaning")
  })
})

describe('STATUS_BADGE', () => {
  it('labels match the Words filter wording and each status has its own colour', () => {
    expect(Object.fromEntries(Object.entries(STATUS_BADGE).map(([k, v]) => [k, v.label]))).toEqual({
      pending: 'Preparing',
      ready: 'Ready',
      failed: 'Needs meaning',
      suspended: 'Suspended',
      duplicate: 'Duplicate',
      deleted: 'Deleted',
    })
    expect(STATUS_BADGE.pending.className).toContain('amber')
    expect(STATUS_BADGE.ready.className).toContain('green')
    expect(STATUS_BADGE.failed.className).toContain('red')
    expect(STATUS_BADGE.suspended.className).toContain('rose')
    expect(STATUS_BADGE.duplicate.className).toContain('orange')
    expect(new Set(Object.values(STATUS_BADGE).map((b) => b.className)).size).toBe(6)
  })
})
