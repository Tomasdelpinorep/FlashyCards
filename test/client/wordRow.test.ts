import { describe, expect, it } from 'vitest'
import { wordRowText } from '../../src/client/lib/wordRow'

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
    expect(wordRowText({ ...base, status: 'failed', genError: 'not_a_word' }).subtitle).toBe('Not recognised as a word')
    expect(wordRowText({ ...base, status: 'failed', genError: 'boom' }).subtitle).toBe('Generation failed')
  })
})
