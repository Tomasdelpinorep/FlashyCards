/** Train front/back view-model (shared/display.ts cardFaces), DUPLICATES.md 10.8 / 10.9 M5. */
import { describe, expect, it } from 'vitest'
import { blankMarkers, cardFaces, introFaces, pickDirection, type StudyCardInput } from '../../src/shared/display'

const beginnen: StudyCardInput = {
  display: 'beginnen',
  translation: 'to begin',
  extraTranslations: ['to start'],
  content: {
    pos: 'verb',
    grammar: {
      gender: null,
      article: null,
      plural: null,
      genitive: null,
      verb: { present_3sg: 'beginnt', past_3sg: 'begann', perfect_3sg: 'hat begonnen', participle: 'begonnen', auxiliary: 'haben', separable: false, reflexive: false },
      governs_case: null,
      comparative: null,
      superlative: null,
      note: null,
    },
    exampleTarget: 'Der Film [[beginnt]] um acht.',
    exampleSource: 'The film [[begins]] at eight.',
  },
  alsoInDeck: [{ id: 'a', display: 'anfangen' }],
}

describe('cardFaces', () => {
  it('DE->EN front: the word and the sentence with the word blanked; hideSentenceOnFront hides it', () => {
    const f = cardFaces(beginnen, 'target-source')
    expect(f.front).toEqual({ kind: 'target', word: 'beginnen', sentence: 'Der Film ____ um acht.' })
    expect(cardFaces(beginnen, 'target-source', { hideSentenceOnFront: true }).front).toEqual({ kind: 'target', word: 'beginnen', sentence: null })
  })

  it('EN->DE front: the translation and ALWAYS example_source with its highlight, even with hideSentenceOnFront', () => {
    for (const hide of [false, true]) {
      const f = cardFaces(beginnen, 'source-target', { hideSentenceOnFront: hide })
      expect(f.front).toEqual({ kind: 'source', translation: 'to begin · also: to start', sentence: 'The film [[begins]] at eight.' })
    }
  })

  it('back: the full card; "Also in your deck" in EN->DE only, never in DE->EN', () => {
    const en = cardFaces(beginnen, 'source-target').back
    expect(en).toEqual({
      word: 'beginnen',
      forms: 'beginnt · begann · hat begonnen',
      translation: 'to begin · also: to start',
      exampleTarget: 'Der Film [[beginnt]] um acht.',
      exampleSource: 'The film [[begins]] at eight.',
      alsoInDeck: [{ id: 'a', display: 'anfangen' }],
    })
    expect(cardFaces(beginnen, 'target-source').back.alsoInDeck).toEqual([])
    expect(cardFaces({ ...beginnen, alsoInDeck: [] }, 'source-target').back.alsoInDeck).toEqual([])
    expect(cardFaces({ ...beginnen, alsoInDeck: undefined }, 'source-target').back.alsoInDeck).toEqual([])
  })

  it('speech: the target word and the sentence without markers', () => {
    expect(cardFaces(beginnen, 'source-target').speech).toEqual({ word: 'beginnen', sentence: 'Der Film beginnt um acht.' })
  })

  it('copes with a card without content', () => {
    const f = cardFaces({ display: 'Hund', translation: null, extraTranslations: [], content: null }, 'source-target')
    expect(f.front).toEqual({ kind: 'source', translation: '', sentence: null })
    expect(f.back.forms).toBeNull()
  })
})

describe('introFaces (Learn intro card, DUPLICATES.md 10.9 M6)', () => {
  it('shows both sides with forms, "· also:", both sentences and "Also in your deck"', () => {
    expect(introFaces(beginnen)).toEqual({
      word: 'beginnen',
      forms: 'beginnt · begann · hat begonnen',
      translation: 'to begin · also: to start',
      exampleTarget: 'Der Film [[beginnt]] um acht.',
      exampleSource: 'The film [[begins]] at eight.',
      alsoInDeck: [{ id: 'a', display: 'anfangen' }],
      speech: { word: 'beginnen', sentence: 'Der Film beginnt um acht.' },
    })
  })

  it('has an empty alsoInDeck when there is none', () => {
    expect(introFaces({ ...beginnen, alsoInDeck: undefined }).alsoInDeck).toEqual([])
    expect(introFaces({ ...beginnen, alsoInDeck: [] }).alsoInDeck).toEqual([])
  })
})

describe('blankMarkers', () => {
  it('blanks every marked part (separable verbs) and leaves unmarked sentences as they are', () => {
    expect(blankMarkers('Ich [[stehe]] um sieben Uhr [[auf]].')).toBe('Ich ____ um sieben Uhr ____.')
    expect(blankMarkers('Ohne Marker.')).toBe('Ohne Marker.')
    expect(blankMarkers('Kaputt [[ohne Ende.')).toBe('Kaputt ohne Ende.')
    expect(blankMarkers(null)).toBeNull()
  })
})

describe('pickDirection', () => {
  it('fixed modes pass through; mixed picks per card', () => {
    expect(pickDirection('target-source')).toBe('target-source')
    expect(pickDirection('source-target', () => 0)).toBe('source-target')
    expect(pickDirection('mixed', () => 0.1)).toBe('target-source')
    expect(pickDirection('mixed', () => 0.9)).toBe('source-target')
  })
})
