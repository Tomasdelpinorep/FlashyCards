import { describe, expect, it } from 'vitest'
import { glossKey, termKey } from '../../src/shared/normalize'

describe('termKey', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(termKey('de', '  Hund ')).toBe('hund')
    expect(termKey('de', 'gehen')).toBe('gehen')
    expect(termKey('de', 'auf   Wiedersehen\t')).toBe('auf wiedersehen')
    expect(termKey('de', 'Straße')).toBe('straße')
  })

  it('strips a leading article of the language (any case), once', () => {
    expect(termKey('de', 'der Hund')).toBe('hund')
    expect(termKey('de', 'Die Katze')).toBe('katze')
    expect(termKey('de', 'das  Haus')).toBe('haus')
    expect(termKey('de', 'ein Apfel')).toBe('apfel')
    expect(termKey('en', 'the dog')).toBe('dog')
    expect(termKey('en', 'an apple')).toBe('apple')
    expect(termKey('es', 'el perro')).toBe('perro')
  })

  it("keeps a word that merely starts like an article, or is one, and other languages' articles", () => {
    expect(termKey('de', 'Derby')).toBe('derby')
    expect(termKey('de', 'die')).toBe('die')
    expect(termKey('de', 'der ')).toBe('der')
    expect(termKey('en', 'der Hund')).toBe('der hund')
    expect(termKey('de', 'the dog')).toBe('the dog')
  })

  it('strips plural notation', () => {
    expect(termKey('de', 'Hund, -e')).toBe('hund')
    expect(termKey('de', 'der Hund, -e')).toBe('hund')
    expect(termKey('de', 'Mann, ¨-er')).toBe('mann')
    expect(termKey('de', 'Mann, -¨er')).toBe('mann')
    expect(termKey('de', 'Zimmer, -')).toBe('zimmer')
    expect(termKey('de', 'Auto,-s')).toBe('auto')
    expect(termKey('de', 'E-Mail, -s')).toBe('e-mail')
    expect(termKey('de', 'der Hund, die Hunde')).toBe('hund')
    expect(termKey('de', 'Hund, pl. Hunde')).toBe('hund')
    expect(termKey('de', 'Hund (pl. Hunde)')).toBe('hund')
    expect(termKey('de', 'der Hund (Pl.: Hunde)')).toBe('hund')
    expect(termKey('de', 'Hund (plural Hunde)')).toBe('hund')
    expect(termKey('de', 'Hund (-e)')).toBe('hund')
    expect(termKey('en', 'child (pl. children)')).toBe('child')
  })

  it('leaves other commas and parentheses alone', () => {
    expect(termKey('de', 'na, ja')).toBe('na, ja')
    expect(termKey('de', 'Bank (Geld)')).toBe('bank (geld)')
  })

  it('normalizes to NFC, so composed and decomposed umlauts match', () => {
    const decomposed = 'Mädchen' // a + combining diaeresis
    expect(decomposed).not.toBe('Mädchen')
    expect(termKey('de', decomposed)).toBe(termKey('de', 'Mädchen'))
    expect(termKey('de', `das ${decomposed}`)).toBe('mädchen')
  })

  it('does not strip English "to" (only articles); glossKey handles that', () => {
    expect(termKey('en', 'to begin')).toBe('to begin')
    expect(termKey('en', 'begin')).toBe('begin')
  })
})

describe('glossKey', () => {
  it('treats "to begin" and "begin" as the same gloss', () => {
    expect(glossKey('en', 'to begin')).toBe('begin')
    expect(glossKey('en', 'To Begin')).toBe(glossKey('en', 'begin'))
  })

  it('strips one English prefix: to, a, an, the', () => {
    expect(glossKey('en', 'a dog')).toBe('dog')
    expect(glossKey('en', 'an apple')).toBe('apple')
    expect(glossKey('en', 'the bank')).toBe('bank')
    expect(glossKey('en', 'to a degree')).toBe('a degree')
    expect(glossKey('en', 'tomato')).toBe('tomato')
    expect(glossKey('en', 'to')).toBe('to')
  })

  it('lowercases, trims, drops (...) and collapses whitespace', () => {
    expect(glossKey('en', '  Bench ')).toBe('bench')
    expect(glossKey('en', 'Bank (financial)')).toBe('bank')
    expect(glossKey('en', '(informal) to  go   away')).toBe('go away')
    expect(glossKey('en', 'to begin (sth.)')).toBe('begin')
  })

  it('uses the prefixes of the given language', () => {
    expect(glossKey('de', 'der Hund')).toBe('hund')
    expect(glossKey('de', 'to begin')).toBe('to begin')
    expect(glossKey('es', 'el perro')).toBe('perro')
  })

  it('normalizes to NFC', () => {
    expect(glossKey('de', 'Mädchen')).toBe('mädchen')
  })

  it('distinguishes different meanings', () => {
    expect(glossKey('en', 'bench')).not.toBe(glossKey('en', 'bank'))
    expect(glossKey('en', 'Bench')).toBe(glossKey('en', 'bench'))
  })
})
