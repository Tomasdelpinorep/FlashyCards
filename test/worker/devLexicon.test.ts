import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEV_LEXICON_DE } from '../../src/worker/ai/devLexicon.de'
import { DEFAULT_LEXICON, FakeGenerator } from '../../src/worker/ai/fake'
import { ItemSchema, PERSON_KEYS } from '../../src/worker/ai/schema'
import { hasValidMarkers } from '../../src/shared/display'
import { termKey } from '../../src/shared/normalize'

const wordlist = JSON.parse(readFileSync('data/wordlists/de.json', 'utf8')) as { items: { rank: number; lemma: string }[] }
const ARTICLE = { masculine: 'der', feminine: 'die', neuter: 'das' } as const

describe('dev lexicon (de)', () => {
  it.each(DEV_LEXICON_DE.map((e) => [e.lemma!, e] as const))('%s is a valid generator item', (_, e) => {
    expect(ItemSchema.safeParse({ input: e.lemma, input_side: 'target', status: 'ok', ...e }).success).toBe(true)
    expect(e.translation?.trim()).toBeTruthy()
    expect(e.cefr).not.toBeNull()
    expect(hasValidMarkers(e.example_target)).toBe(true)
    expect(hasValidMarkers(e.example_source)).toBe(true)
    const g = e.grammar!
    if (e.pos === 'noun') {
      expect(e.lemma![0]).toBe(e.lemma![0]!.toUpperCase())
      // Plural-only nouns (die Leute) have no gender/article; uncountables say why there is no plural.
      if (g.gender) expect(g.article).toBe(ARTICLE[g.gender])
      else expect(g.note).toMatch(/plural only/i)
      if (!g.plural) expect(g.note).toMatch(/no plural/i)
      else expect(g.plural).toMatch(/^die \S/)
      expect(g.genitive).toMatch(/^(des|der) \S/)
    }
    if (e.pos === 'verb') {
      const v = g.verb!
      for (const t of [v.present, v.past]) for (const k of PERSON_KEYS) expect(t?.[k]?.trim()).toBeTruthy()
      expect(v.present_3sg).toBe(v.present!.p3s)
      expect(v.past_3sg).toBe(v.past!.p3s)
      expect(['haben', 'sein']).toContain(v.auxiliary)
      expect(v.perfect_3sg).toMatch(new RegExp(`^(hat|ist) (sich )?${v.participle}$`))
    }
    if (e.pos === 'preposition') expect(g.governs_case).toMatch(/^(accusative|dative|genitive|accusative or dative)$/)
  })

  it('has unique lemmas and covers the first 150 word-list lemmas', () => {
    const keys = DEV_LEXICON_DE.map((e) => termKey('de', e.lemma!))
    expect(new Set(keys).size).toBe(keys.length)
    const known = new Set([...keys, ...Object.keys(DEFAULT_LEXICON).map((k) => k.replace(/^target:/, ''))])
    const first = wordlist.items.filter((w) => w.rank <= 150).map((w) => termKey('de', w.lemma))
    expect(first.filter((k) => !known.has(k))).toEqual([])
  })

  it('the fake generator answers from it on both sides, after the built-in lexicon', async () => {
    const fake = new FakeGenerator()
    const items = await fake.generate({
      sourceLang: 'en',
      targetLang: 'de',
      level: 'A1-A2',
      items: [
        { input: 'die Zeit', hint: null, inputLang: 'target' },
        { input: 'book', hint: null, inputLang: 'source' },
        { input: 'to understand', hint: null, inputLang: 'auto' },
        { input: 'dog', hint: null, inputLang: 'source' },
        { input: 'Zwetschge', hint: null, inputLang: 'target' },
      ],
    })
    expect(items.map((i) => [i.lemma, i.input_side])).toEqual([
      ['Zeit', 'target'],
      ['Buch', 'source'],
      ['verstehen', 'source'],
      ['Hund', 'source'],
      ['Zwetschge', 'target'],
    ])
    expect(items[0]).toMatchObject({ input: 'die Zeit', pos: 'noun', grammar: { article: 'die', plural: 'die Zeiten' } })
    expect(items[4]!.pos).toBe('other') // unknown words keep the placeholder entry
  })
})
