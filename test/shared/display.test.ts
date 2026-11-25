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
  verbTable,
  withArticle,
} from '../../src/shared/display'

describe('verbTable', () => {
  const verb = (present: unknown, past: unknown) => ({
    pos: 'verb',
    grammar: { verb: { present, past, present_3sg: 'geht', past_3sg: 'ging', perfect_3sg: 'ist gegangen' } } as never,
  })
  const t = { p1s: 'gehe', p2s: 'gehst', p3s: 'geht', p1p: 'gehen', p2p: 'geht', p3p: 'gehen' }
  it('rows with the language person labels', () => {
    const rows = verbTable(verb(t, { ...t, p1s: 'ging' }), 'de')
    expect(rows).toHaveLength(6)
    expect(rows![0]).toEqual({ person: 'ich', present: 'gehe', past: 'ging' })
    expect(rows![5]!.person).toBe('sie/Sie')
    expect(verbTable(verb(t, null), 'es')![0]).toEqual({ person: 'yo', present: 'gehe', past: null })
  })
  it('null for old entries, partial tables and non-verbs', () => {
    expect(verbTable(verb(undefined, undefined), 'de')).toBeNull()
    expect(verbTable(verb({ ...t, p3p: '' }, null), 'de')).toBeNull()
    expect(verbTable({ pos: 'noun', grammar: null }, 'de')).toBeNull()
    expect(verbTable(null, 'de')).toBeNull()
  })
})

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
  it('an edited sentence (override) without markers renders plain; with markers it highlights', () => {
    const entry = {
      lemma: 'Hund', pos: 'noun', translation: 'dog', alt_translations_json: '[]', cefr: 'A1', grammar_json: null,
      example_target: 'Der [[Hund]] bellt.', example_source: 'The [[dog]] barks.',
    }
    const plain = mergeContent(entry, JSON.stringify({ exampleTarget: 'Mein Hund schläft.' }))!
    expect(highlightSegments(plain.exampleTarget)).toEqual([{ text: 'Mein Hund schläft.', mark: false }])
    expect(plain.exampleSource).toBe('The [[dog]] barks.')
    const marked = mergeContent(entry, JSON.stringify({ exampleTarget: 'Mein [[Hund]] schläft.' }))!
    expect(highlightSegments(marked.exampleTarget).filter((s) => s.mark).map((s) => s.text)).toEqual(['Hund'])
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
    expect(articleColor('de', 'die Hunde')?.color).toBe('red')
    expect(articleColor('de', 'Das macht nichts.')).toBeNull() // a phrase, not a neuter noun
    expect(articleColor('de', 'der Hund?')).toBeNull()
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
