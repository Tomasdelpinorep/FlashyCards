import { describe, expect, it } from 'vitest'
import {
  articleColor,
  duplicateOfText,
  formsLine,
  hasValidMarkers,
  highlightSegments,
  mergeContent,
  stripMarkers,
  translationLine,
  withArticle,
} from '../../src/shared/display'

describe('[[ ]] markers', () => {
  it('splits a sentence into highlighted parts', () => {
    expect(highlightSegments('Der [[Hund]] bellt.')).toEqual([
      { text: 'Der ', mark: false },
      { text: 'Hund', mark: true },
      { text: ' bellt.', mark: false },
    ])
    expect(highlightSegments('Ich [[stehe]] um sieben [[auf]].').filter((s) => s.mark).map((s) => s.text)).toEqual(['stehe', 'auf'])
  })
  it('shows a sentence without valid markers unhighlighted', () => {
    expect(hasValidMarkers('Der Hund bellt.')).toBe(false)
    expect(hasValidMarkers('Der [[Hund bellt.')).toBe(false)
    expect(highlightSegments('Der [[Hund bellt.')).toEqual([{ text: 'Der Hund bellt.', mark: false }])
    expect(stripMarkers('a [[b]] c]]')).toBe('a b c')
    expect(highlightSegments(null)).toEqual([])
  })
})

describe('display helpers', () => {
  it('translationLine: "big · also: large"', () => {
    expect(translationLine('big', ['large'])).toBe('big · also: large')
    expect(translationLine('big', [])).toBe('big')
    expect(translationLine('big', ['Big', 'huge'])).toBe('big · also: huge')
    expect(translationLine(null, [])).toBe('')
  })
  it('formsLine per part of speech', () => {
    const g = { gender: null, article: null, plural: null, genitive: null, verb: null, governs_case: null, comparative: null, superlative: null, note: null }
    expect(formsLine({ pos: 'noun', grammar: { ...g, plural: 'die Hunde' } })).toBe('Plural: die Hunde')
    expect(
      formsLine({
        pos: 'verb',
        grammar: { ...g, verb: { present_3sg: 'geht', past_3sg: 'ging', perfect_3sg: 'ist gegangen', participle: 'gegangen', auxiliary: 'sein', separable: false, reflexive: false } },
      }),
    ).toBe('geht · ging · ist gegangen')
    expect(formsLine({ pos: 'adjective', grammar: { ...g, comparative: 'größer', superlative: 'am größten' } })).toBe('größer · am größten')
    expect(formsLine({ pos: 'preposition', grammar: { ...g, governs_case: 'dative' } })).toBe('+ dative')
    expect(formsLine(null)).toBeNull()
  })
  it('article colours come from languages.ts', () => {
    expect(articleColor('de', 'der Hund')).toEqual({ article: 'der', rest: ' Hund', color: 'blue' })
    expect(articleColor('de', 'die Katze')?.color).toBe('red')
    expect(articleColor('de', 'das Haus')?.color).toBe('green')
    expect(articleColor('de', 'gehen')).toBeNull()
    expect(articleColor('en', 'the dog')).toBeNull()
    expect(withArticle('Hund', 'der')).toBe('der Hund')
    expect(withArticle('der Hund', 'der')).toBe('der Hund')
  })
  it('mergeContent applies override_json over the entry', () => {
    const entry = {
      lemma: 'Hund',
      pos: 'noun',
      translation: 'dog',
      alt_translations_json: '["hound"]',
      cefr: 'A1',
      grammar_json: '{"gender":"masculine","article":"der","plural":"die Hunde"}',
      example_target: 'Der [[Hund]] bellt.',
      example_source: 'The [[dog]] barks.',
    }
    expect(mergeContent(entry, null)).toMatchObject({ lemma: 'Hund', altTranslations: ['hound'], grammar: { article: 'der' } })
    expect(mergeContent(entry, '{"translation":"hound","grammar":{"plural":"die Hünde"}}')).toMatchObject({
      translation: 'hound',
      grammar: { article: 'der', plural: 'die Hünde' },
      exampleTarget: 'Der [[Hund]] bellt.',
    })
    expect(mergeContent(entry, 'not json')).toMatchObject({ translation: 'dog' })
    expect(mergeContent(null, null)).toBeNull()
  })
  it('duplicateOfText', () => {
    expect(duplicateOfText({ display: 'der Hund' })).toBe('Already in your deck as der Hund')
  })
})
