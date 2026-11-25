import { describe, expect, it } from 'vitest'
import { checkAnswer, checkAnyAnswer, damerau, diffChars, expectedFor, gradeForVerdict, verdictText, type Expected } from '../../src/shared/answerCheck'

const hund: Expected = { primary: 'der Hund', alternatives: [], isNoun: true, article: 'der' }
const verdict = (input: string, e: Expected, lang = 'de', mode: 'live' | 'final' = 'final') => checkAnswer(input, e, lang, mode).verdict

describe('checkAnswer', () => {
  it('requires the article for German nouns', () => {
    expect(verdict('der Hund', hund)).toBe('correct')
    expect(verdict('  Der   HUND. ', hund)).toBe('correct')
    expect(checkAnswer('Hund', hund, 'de', 'final')).toMatchObject({ verdict: 'missing-article', shown: 'der Hund' })
    expect(verdict('die Hund', hund)).toBe('wrong-article')
    expect(verdict('ein Hund', hund)).toBe('wrong-article')
  })

  it('folds umlauts and ß both ways', () => {
    const muede: Expected = { primary: 'müde', alternatives: [], isNoun: false, article: null }
    expect(verdict('Muede', muede)).toBe('correct')
    expect(verdict('müde', muede)).toBe('correct')
    expect(verdict('gross', { primary: 'groß', alternatives: [], isNoun: false, article: null })).toBe('correct')
  })

  it('live mode accepts only a full match ("die" is not "die Hunde")', () => {
    const hunde: Expected = { primary: 'die Hunde', alternatives: [], isNoun: true, article: 'die' }
    expect(verdict('die', hunde, 'de', 'live')).toBe('pending')
    expect(verdict('die Hund', hunde, 'de', 'live')).toBe('pending')
    expect(verdict('Hunde', hunde, 'de', 'live')).toBe('pending')
    expect(verdict('die Hunde', hunde, 'de', 'live')).toBe('correct')
  })

  it('one typo counts only on terms of 5+ letters, measured without the article', () => {
    expect(verdict('der Hnud', hund)).toBe('wrong') // Hund has 4 letters
    const katze: Expected = { primary: 'die Katze', alternatives: [], isNoun: true, article: 'die' }
    expect(verdict('die Katez', katze)).toBe('typo') // transposition
    expect(verdict('die Kaze', katze)).toBe('typo')
    expect(verdict('die Kazze', katze)).toBe('typo')
    expect(verdict('die Kz', katze)).toBe('wrong')
    expect(verdict('der Katze', katze)).toBe('wrong-article')
    expect(verdict('hosue', { primary: 'house', alternatives: [], isNoun: false, article: null }, 'en')).toBe('typo')
  })

  it('ignores "to" on English verbs', () => {
    const go: Expected = { primary: 'to go', alternatives: ['to walk'], isNoun: false, article: null }
    expect(verdict('go', go, 'en')).toBe('correct')
    expect(verdict('to go', go, 'en', 'live')).toBe('correct')
    expect(verdict('walk', go, 'en')).toBe('correct')
    expect(verdict('to', go, 'en', 'live')).toBe('pending')
  })

  it('folds Spanish accents and requires the Spanish article', () => {
    const arbol: Expected = { primary: 'el árbol', alternatives: [], isNoun: true, article: 'el' }
    expect(verdict('el arbol', arbol, 'es')).toBe('correct')
    expect(verdict('arbol', arbol, 'es')).toBe('missing-article')
  })

  it('accepts alternatives, split on , and ; with (notes) dropped', () => {
    const big: Expected = { primary: 'big', alternatives: ['large; tall', 'huge (very big)'], isNoun: false, article: null }
    expect(verdict('large', big, 'en')).toBe('correct')
    expect(verdict('tall', big, 'en')).toBe('correct')
    expect(verdict('huge', big, 'en')).toBe('correct')
    expect(verdict('small', big, 'en')).toBe('wrong')
  })

  it('phrases: punctuation, apostrophes and the ellipsis are ignored, commas do not split', () => {
    const moment: Expected = { primary: 'Einen Moment, bitte.', alternatives: [], isNoun: false, article: null, isPhrase: true }
    expect(verdict('einen moment bitte', moment)).toBe('correct')
    expect(verdict('Einen Moment, bitte!', moment)).toBe('correct')
    expect(verdict('bitte', moment)).toBe('wrong')
    expect(verdict('Einen Moment', moment)).toBe('wrong')
    const leid: Expected = { primary: 'Es tut mir leid.', alternatives: [], isNoun: false, article: null, isPhrase: true }
    expect(verdict('es tut mir leid', leid, 'de', 'live')).toBe('correct')
    expect(verdict('Es tut mir lied', leid)).toBe('typo')
    const gefallen: Expected = { primary: 'Wie gefällt dir …?', alternatives: [], isNoun: false, article: null, isPhrase: true }
    for (const a of ['wie gefällt dir', 'Wie gefaellt dir ...?', 'Wie gefällt dir …?', 'wie gefällt dir?']) expect(verdict(a, gefallen)).toBe('correct')
    const sorry: Expected = { primary: 'I’m sorry', alternatives: ['I am sorry'], isNoun: false, article: null, isPhrase: true }
    for (const a of ["I'm sorry", 'Im sorry.', 'i am sorry!']) expect(verdict(a, sorry, 'en')).toBe('correct')
    const repeat: Expected = { primary: 'could you please repeat that?', alternatives: ['could you repeat that, please?'], isNoun: false, article: null, isPhrase: true }
    expect(verdict('Could you repeat that please', repeat, 'en')).toBe('correct')
    expect(verdict('please', repeat, 'en')).toBe('wrong')
  })

  it('a trailing ellipsis is ignored for any answer', () => {
    expect(verdict('how do you like', { primary: 'how do you like …', alternatives: [], isNoun: false, article: null }, 'en')).toBe('correct')
  })

  it('the German reflexive pronoun is optional', () => {
    const anmelden: Expected = { primary: 'sich anmelden', alternatives: [], isNoun: false, article: null }
    expect(verdict('sich anmelden', anmelden)).toBe('correct')
    expect(verdict('anmelden', anmelden)).toBe('correct')
    expect(verdict('sich fühlen', { primary: 'fühlen', alternatives: [], isNoun: false, article: null })).toBe('correct')
  })

  it('an empty answer is wrong (final) or pending (live)', () => {
    expect(verdict('', hund)).toBe('wrong')
    expect(verdict('   ', hund, 'de', 'live')).toBe('pending')
  })

  it('picks the best of several speech alternatives', () => {
    expect(checkAnyAnswer(['der Mund', 'der Hund'], hund, 'de', 'final')).toMatchObject({ verdict: 'correct', input: 'der Hund' })
  })
})

describe('grades and texts', () => {
  it('maps verdicts to grades', () => {
    expect(gradeForVerdict('correct')).toBe(3)
    expect(gradeForVerdict('typo')).toBe(2)
    expect(gradeForVerdict('missing-article')).toBe(1)
    expect(gradeForVerdict('wrong')).toBe(1)
  })
  it('explains the verdict', () => {
    expect(verdictText({ verdict: 'missing-article', shown: 'der Hund' })).toBe('Missing the article: der Hund')
    expect(verdictText({ verdict: 'wrong', shown: 'der Hund' })).toBe('Not quite. The answer is der Hund')
  })
})

describe('damerau and diffChars', () => {
  it('counts a transposition as one edit', () => {
    expect(damerau('katze', 'katez')).toBe(1)
    expect(damerau('abc', 'abc')).toBe(0)
    expect(damerau('abcdef', 'a', 2)).toBe(3)
  })
  it('marks missing and extra characters', () => {
    expect(diffChars('Hund', 'der Hund')).toEqual([
      { text: 'der ', op: 'insert' },
      { text: 'Hund', op: 'equal' },
    ])
    expect(diffChars('Katxe', 'Katze').map((s) => s.op)).toEqual(['equal', 'delete', 'insert', 'equal'])
  })
})

describe('expectedFor', () => {
  const card = {
    display: 'der Hund',
    translation: 'dog',
    extraTranslations: ['doggo'],
    content: { pos: 'noun', altTranslations: ['hound'], grammar: { article: 'der' } },
  }
  const langs = { sourceLang: 'en', targetLang: 'de' }
  it('target -> source expects the translation and its alternatives', () => {
    expect(expectedFor(card, 'target-source', langs)).toEqual({
      lang: 'en',
      expected: { primary: 'dog', alternatives: ['hound', 'doggo'], isNoun: false, article: null },
    })
  })
  it('source -> target expects the display with its article', () => {
    expect(expectedFor(card, 'source-target', langs)).toEqual({
      lang: 'de',
      expected: { primary: 'der Hund', alternatives: [], isNoun: true, article: 'der' },
    })
  })
  it('a phrase is checked as a phrase both ways', () => {
    const phrase = { display: 'Das macht nichts.', translation: 'that doesn’t matter', extraTranslations: [], content: { pos: 'phrase', altTranslations: ['never mind'], grammar: { article: null } } }
    expect(expectedFor(phrase, 'source-target', langs).expected).toMatchObject({ primary: 'Das macht nichts.', isNoun: false, isPhrase: true })
    expect(expectedFor(phrase, 'target-source', langs).expected).toMatchObject({ primary: 'that doesn’t matter', isPhrase: true })
    expect(checkAnswer('das macht nichts', expectedFor(phrase, 'source-target', langs).expected, 'de', 'final').verdict).toBe('correct')
  })
})
