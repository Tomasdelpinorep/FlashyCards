/** M7 data quality: data/wordlists/de.json and the migration generated from it. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { wordlistToSql, type WordlistFile } from '../../scripts/wordlist-to-sql'
import { LANGUAGES } from '../../src/shared/languages'
import { termKey } from '../../src/shared/normalize'
import { POS_VALUES } from '../../src/worker/ai/schema'

const list = JSON.parse(readFileSync('data/wordlists/de.json', 'utf8')) as WordlistFile

/** Obvious names, fillers, English words, profanity and inflected forms that must not be lemmas. */
const DENYLIST = [
  'peter', 'john', 'michael', 'jack', 'sam', 'tom', 'mary', 'paris', 'london', 'berlin', 'hause',
  'äh', 'ähm', 'hm', 'oh', 'ah', 'hey', 'hi', 'okay', 'ok', 'wow', 'na', 'ne', 'tja', 'mhm',
  'the', 'you', 'yeah', 'sir', 'mr.', 'dad', 'mom', 'sorry', 'scheiße', 'arschloch', 'fick',
  'ging', 'war', 'ist', 'hat', 'kinder', 'besser', 'mir', 'dem', 'zum', 'im', 'a', 's', 'n',
]

describe('data/wordlists/de.json', () => {
  it('has at least 4,000 lemmas with source, license and attribution', () => {
    expect(list.items.length).toBeGreaterThanOrEqual(4000)
    expect(list.license).toBe('CC-BY-SA-4.0')
    expect(list.source).toContain('FrequencyWords')
    expect(list.attribution).toContain('Hermit Dave')
    expect(LANGUAGES.de.hasWordlist).toBe(true)
    expect(LANGUAGES.de.wordlist?.license).toBe(list.license)
  })

  it('ranks are contiguous from 1 and POS values are valid', () => {
    list.items.forEach((it, i) => expect(it.rank).toBe(i + 1))
    const invalid = list.items.filter((it) => !(POS_VALUES as readonly string[]).includes(it.pos))
    expect(invalid).toEqual([])
  })

  it('lemmas are unique by lemma key (termKey), non-empty and trimmed; nouns are capitalised', () => {
    const keys = list.items.map((it) => termKey('de', it.lemma))
    expect(new Set(keys).size).toBe(keys.length)
    for (const it of list.items) {
      expect(it.lemma).toBe(it.lemma.normalize('NFC').trim())
      expect(it.lemma.length).toBeGreaterThan(1)
      if (it.pos === 'noun') expect(it.lemma[0], it.lemma).toBe(it.lemma[0]!.toUpperCase())
      else expect(it.lemma[0], it.lemma).toBe(it.lemma[0]!.toLowerCase())
    }
  })

  it('contains none of the denylisted names, fillers or inflected forms', () => {
    const keys = new Set(list.items.map((it) => termKey('de', it.lemma)))
    expect(DENYLIST.filter((w) => keys.has(w))).toEqual([])
  })

  it('starts with the expected function words and keeps common lemmas', () => {
    expect(list.items.slice(0, 5).map((it) => it.lemma)).toEqual(['ich', 'sie', 'der', 'sein', 'du'])
    const lemmas = new Set(list.items.map((it) => it.lemma))
    for (const w of ['Haus', 'gehen', 'gut', 'Hund', 'Kind', 'haben', 'werden', 'Zeit']) expect(lemmas.has(w), w).toBe(true)
  })

  it('migrations/0002_wordlist_de.sql is up to date (npm run wordlist:sql)', () => {
    expect(readFileSync('migrations/0002_wordlist_de.sql', 'utf8').replace(/\r\n/g, '\n')).toBe(wordlistToSql('de', list))
  })
})
