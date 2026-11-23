/**
 * The curated en -> de dictionary (src/worker/ai/curated.de.ts: devLexicon.de.ts + data/seed/de
 * batches) and its seed migration. Regenerate with `npm run seed:sql` after any change.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasValidMarkers } from '../../src/shared/display'
import { termKey } from '../../src/shared/normalize'
import { CURATED_DE } from '../../src/worker/ai/curated.de'
import { FakeGenerator } from '../../src/worker/ai/fake'
import { ItemSchema, PERSON_KEYS } from '../../src/worker/ai/schema'
import { latestSeedSqlFile, readSeedLemmas, seedSql } from '../../scripts/curated-to-sql'

const ARTICLE = { masculine: 'der', feminine: 'die', neuter: 'das' } as const

describe('curated dictionary (de)', () => {
  it.each(CURATED_DE.map((e) => [e.lemma!, e] as const))('%s is a complete, valid entry', (_, e) => {
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
      else expect(g.note).toMatch(/plural/i)
      if (!g.plural) expect(g.note).toMatch(/plural/i)
      else expect(g.plural).toMatch(/^die \S/)
    }
    if (e.pos === 'verb') {
      const v = g.verb!
      for (const t of [v.present, v.past]) for (const k of PERSON_KEYS) expect(t?.[k]?.trim()).toBeTruthy()
      expect(v.present_3sg).toBe(v.present!.p3s)
      expect(v.past_3sg).toBe(v.past!.p3s)
      expect(['haben', 'sein']).toContain(v.auxiliary)
    }
  })

  it('has one entry per lemma key and covers all 600 chosen lemmas', () => {
    const keys = CURATED_DE.map((e) => termKey('de', e.lemma!))
    expect(new Set(keys).size).toBe(keys.length)
    const lemmas = readSeedLemmas()
    expect(lemmas).toHaveLength(600)
    const known = new Set(keys.flatMap((k) => (k.startsWith('sich ') ? [k, k.slice(5)] : [k])))
    expect(lemmas.filter((l) => !known.has(termKey('de', l)))).toEqual([])
  })

  it('the newest committed *_seed_de.sql equals the regenerated SQL (run npm run seed:sql)', () => {
    expect(readFileSync(latestSeedSqlFile(), 'utf8').replace(/\r\n/g, '\n')).toBe(seedSql(CURATED_DE).sql)
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
    expect(items[4]!.pos).toBe('other') // unknown words keep the placeholder entry
  })
})
