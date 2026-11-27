/**
 * The curated en -> de dictionary (src/worker/ai/curated.de.ts: devLexicon.de.ts + data/seed/de
 * batches) and its seed migrations. Regenerate with `npm run seed:sql` after any change.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasValidMarkers } from '../../src/shared/display'
import { termKey } from '../../src/shared/normalize'
import { CURATED_DE, CURATED_DE_BASE, CURATED_ES_DE, withSpanish } from '../../src/worker/ai/curated.de'
import { FakeGenerator } from '../../src/worker/ai/fake'
import { ItemSchema, PERSON_KEYS } from '../../src/worker/ai/schema'
import { fullSeedSql, readSeedLemmas, seedSqlPath, seedStagesSql } from '../../scripts/curated-to-sql'
import { createTestD1 } from '../helpers/d1'

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

  it('every committed seed migration equals its regenerated SQL (run npm run seed:sql)', async () => {
    const stages = await seedStagesSql()
    expect(stages.map((s) => s.file)).toEqual(['0003_seed_de.sql', '0005_seed_de_a2.sql', '0006_seed_es_de.sql'])
    for (const { file, result } of stages) expect(readFileSync(seedSqlPath(file), 'utf8').replace(/\r\n/g, '\n')).toBe(result.sql)
    // 0003 has to stay the base dictionary; 0005 adds only the new entries.
    expect(stages[0]!.result.entries).toBe(CURATED_DE_BASE.length)
    expect(stages[1]!.result.entries).toBe(CURATED_DE.length - CURATED_DE_BASE.length)
    // 0006 is the whole es -> de dictionary.
    expect(stages[2]!.result.entries).toBe(CURATED_ES_DE.length)
  })

  it('the seed migrations together give the same entries and aliases as the whole dictionary at once', async () => {
    const dump = (sqlite: ReturnType<typeof createTestD1>['sqlite']) => ({
      entries: sqlite.prepare("SELECT * FROM entries WHERE source_lang = 'en' ORDER BY id").all().map((r) => ({ ...r })),
      aliases: sqlite
        .prepare(
          "SELECT a.input_side, a.alias_key, e.lemma_key FROM entry_aliases a JOIN entries e ON e.id = a.entry_id WHERE a.source_lang = 'en' ORDER BY 1, 2",
        )
        .all()
        .map((r) => ({ ...r })),
    })
    const staged = createTestD1({ seed: true }).sqlite
    const whole = createTestD1().sqlite
    whole.exec((await fullSeedSql()).sql)
    const a = dump(staged)
    expect(a.entries).toHaveLength(CURATED_DE.length)
    expect(a).toEqual(dump(whole))
  })

  it('resolves every line of the A2 import list (test/fixtures/german-a2-words.txt) to exactly one entry', () => {
    const lines = readFileSync(join(__dirname, '..', 'fixtures', 'german-a2-words.txt'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim())
    expect(lines).toHaveLength(148)
    const db = createTestD1({ seed: true }).sqlite
    const hits = db.prepare(
      "SELECT COUNT(*) AS n FROM entry_aliases WHERE source_lang = 'en' AND target_lang = 'de' AND input_side = 'target' AND alias_key = ? AND sense_key = ''",
    )
    expect(lines.filter((l) => (hits.get(termKey('de', l)) as { n: number }).n !== 1)).toEqual([])
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

describe('curated dictionary (es -> de)', () => {
  it('has the same German side as the en -> de dictionary, in the same order', () => {
    expect(CURATED_ES_DE).toHaveLength(CURATED_DE.length)
    CURATED_ES_DE.forEach((es, i) => {
      const en = CURATED_DE[i]!
      expect({ lemma: es.lemma, pos: es.pos, cefr: es.cefr, example_target: es.example_target }).toEqual({
        lemma: en.lemma,
        pos: en.pos,
        cefr: en.cefr,
        example_target: en.example_target,
      })
      expect({ ...es.grammar, note: null }).toEqual({ ...en.grammar, note: null })
    })
  })

  it.each(CURATED_ES_DE.map((e) => [e.lemma!, e] as const))('%s has a Spanish meaning and example', (_, e) => {
    expect(e.translation?.trim()).toBeTruthy()
    // Commas and semicolons split typed answers; a slash is not a valid answer either.
    expect(e.translation).not.toMatch(/[,;/]/)
    expect(e.alt_translations.length).toBeLessThanOrEqual(3)
    expect(hasValidMarkers(e.example_source)).toBe(true)
    // Nouns are stored without their article ("casa", not "la casa").
    if (e.pos === 'noun') expect(e.translation).not.toMatch(/^(el|la|los|las|un|una) /)
  })

  it('rejects a Spanish file that does not line up with its German entries', () => {
    const german = CURATED_DE.slice(0, 2)
    const side = (lemma: string) => ({ lemma, translation: 'x', alt_translations: [], example_source: null, note: null })
    expect(() => withSpanish(german, [side(german[0]!.lemma!)], 'f.json')).toThrow(/1 Spanish items for 2/)
    expect(() => withSpanish(german, [side(german[1]!.lemma!), side(german[0]!.lemma!)], 'f.json')).toThrow(/item 0/)
  })

  it('resolves the Spanish words to their German entries after seeding', () => {
    const db = createTestD1({ seed: true }).sqlite
    const lookup = db.prepare(
      `SELECT e.lemma FROM entry_aliases a JOIN entries e ON e.id = a.entry_id
       WHERE a.source_lang = 'es' AND a.target_lang = 'de' AND a.input_side = ? AND a.alias_key = ?`,
    )
    const lemma = (side: string, key: string) => (lookup.get(side, key) as { lemma: string } | undefined)?.lemma
    expect(lemma('source', termKey('es', 'perro'))).toBe('Hund')
    expect(lemma('source', termKey('es', 'jefe'))).toBe('Chef')
    expect(lemma('source', termKey('es', 'tío'))).toBe('Onkel')
    expect(lemma('target', termKey('de', 'Hund'))).toBe('Hund')
    const count = db.prepare("SELECT COUNT(*) AS n FROM entries WHERE source_lang = 'es' AND target_lang = 'de'").get() as { n: number }
    expect(count.n).toBe(CURATED_ES_DE.length)
  })
})
