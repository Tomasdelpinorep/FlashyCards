import { describe, expect, it } from 'vitest'
import { FakeGenerator } from '../../src/worker/ai/fake'
import { PROMPT_VERSION } from '../../src/worker/ai/prompts'
import { BatchSchema, type GeneratedItem } from '../../src/worker/ai/schema'
import { fixGender, fixVerbTables, matchItems, validateItem } from '../../src/worker/services/generation'
import { checkBudget, consumeBudget, nextUtcMidnight, utcDay } from '../../src/worker/services/rateLimit'
import { createTestD1 } from '../helpers/d1'

const pair = { sourceLang: 'en', targetLang: 'de' } as const
const base: GeneratedItem = {
  input: 'Hund',
  input_side: 'target',
  status: 'ok',
  lemma: 'Hund',
  pos: 'noun',
  translation: 'dog',
  alt_translations: [],
  cefr: null,
  grammar: null,
  example_target: 'Der [[Hund]] bellt.',
  example_source: 'The [[dog]] barks.',
}
const group = (inputLang: 'target' | 'source' | 'auto', hintKey = '') => ({
  input: { input: 'Hund', hint: null, inputLang },
  cards: [{ hintKey } as never],
})
const g0 = { gender: null, article: null, plural: null, genitive: null, verb: null, governs_case: null, comparative: null, superlative: null, note: null }

describe('post-validation', () => {
  it('article agrees with gender', () => {
    const de = { masculine: 'der', feminine: 'die', neuter: 'das' }
    expect(fixGender({ ...g0, gender: 'feminine', article: 'der' }, de)).toMatchObject({ gender: 'feminine', article: 'die' })
    expect(fixGender({ ...g0, gender: null, article: 'Das' }, de)).toMatchObject({ gender: 'neuter', article: 'das' })
    expect(fixGender({ ...g0, gender: null, article: 'xyz' }, de)).toMatchObject({ gender: null, article: null })
    expect(fixGender({ ...g0, article: 'the' }, undefined)).toMatchObject({ article: 'the' })
  })

  it('normalises the item: lemma without article, sense key from the hint, side, markers', () => {
    const v = validateItem({ ...base, lemma: 'der Hund', example_target: 'Der Hund bellt.' }, group('target', 'hound'), pair)
    expect(v).toMatchObject({ kind: 'ok', side: 'target', entry: { lemma: 'Hund', lemma_key: 'hund', sense_key: 'hound', example_target: 'Der Hund bellt.' } })
    expect(validateItem({ ...base, input_side: 'source' }, group('auto'), pair)).toMatchObject({ side: 'source' })
    expect(validateItem({ ...base, input_side: 'source' }, group('target'), pair)).toMatchObject({ side: 'target' })
    expect(validateItem({ ...base, status: 'not_a_word' }, group('target'), pair)).toEqual({ kind: 'not_a_word' })
    expect(validateItem({ ...base, lemma: '  ' }, group('target'), pair)).toMatchObject({ kind: 'invalid' })
  })

  it('drops a verb table with any empty slot, keeps a full one', () => {
    const full = { p1s: 'gehe', p2s: 'gehst', p3s: 'geht', p1p: 'gehen', p2p: 'geht', p3p: ' gehen ' }
    const verb = { present_3sg: 'geht', past_3sg: 'ging', perfect_3sg: 'ist gegangen', participle: 'gegangen', auxiliary: 'sein', separable: false, reflexive: false }
    const g = fixVerbTables({ ...g0, verb: { ...verb, present: full, past: { ...full, p2p: '' } } })
    expect(g.verb?.present).toEqual({ ...full, p3p: 'gehen' })
    expect(g.verb?.past).toBeNull()
    expect(fixVerbTables({ ...g0, verb: { ...verb, present: { ...full, p1s: null }, past: null } }).verb?.present).toBeNull()
    const item = validateItem({ ...base, lemma: 'gehen', pos: 'verb', grammar: { ...g0, verb: { ...verb, present: full, past: { ...full, p1s: null } } } }, group('target'), pair)
    expect(item).toMatchObject({ kind: 'ok', entry: { grammar: { verb: { past: null, present: { p1s: 'gehe' } } } } })
  })

  it('the fake generator returns schema-valid items with verb tables (prompt v3)', async () => {
    expect(PROMPT_VERSION).toBe(3)
    const fake = new FakeGenerator()
    const items = await fake.generate({
      sourceLang: 'en',
      targetLang: 'de',
      level: 'A1-A2',
      items: ['gehen', 'Hund', 'laufenzz'].map((input) => ({ input, hint: null, inputLang: 'target' as const })),
    } as never)
    expect(BatchSchema.safeParse({ items }).success).toBe(true)
    expect(items[0]!.grammar?.verb?.present).toEqual({ p1s: 'gehe', p2s: 'gehst', p3s: 'geht', p1p: 'gehen', p2p: 'geht', p3p: 'gehen' })
    expect(items[0]!.grammar?.verb?.past?.p2s).toBe('gingst')
    expect(items[1]!.grammar?.verb).toBeNull()
  })

  it('matches outputs to inputs by input, then case-insensitively, then by position', () => {
    const a = { ...base, input: 'b' }
    const b = { ...base, input: 'A' }
    const c = { ...base, input: '???' }
    expect(matchItems(['a', 'b', 'c'], [a, b, c])).toEqual([b, a, c])
    expect(matchItems(['a', 'b'], [a])).toEqual([undefined, a])
  })
})

describe('rate limit consumption (guarded upsert)', () => {
  const limits = { user: 5, global: 8 }
  const now = Date.UTC(2026, 10, 17, 15, 0, 0)

  it('consumes both rows or neither', async () => {
    const { db, sqlite } = createTestD1()
    expect(utcDay(now)).toBe('2026-11-17')
    expect(nextUtcMidnight(now)).toBe(Date.UTC(2026, 10, 18))
    expect(await consumeBudget(db, 'u1', 4, limits, now)).toBe(true)
    expect(await consumeBudget(db, 'u1', 2, limits, now)).toBe(false) // user would reach 6 > 5
    expect(await consumeBudget(db, 'u2', 4, limits, now)).toBe(true) // global 8
    expect(await consumeBudget(db, 'u3', 1, limits, now)).toBe(false) // global would reach 9 > 8
    expect(sqlite.prepare('SELECT scope, words, calls FROM ai_usage ORDER BY scope').all()).toEqual([
      { scope: 'global', words: 8, calls: 2 },
      { scope: 'user:u1', words: 4, calls: 1 },
      { scope: 'user:u2', words: 4, calls: 1 },
    ])
    expect(await checkBudget(db, 'u1', 10, limits, now)).toEqual({ allowed: 0, resetsAt: Date.UTC(2026, 10, 18) })
    // A new day starts fresh.
    expect(await checkBudget(db, 'u1', 10, limits, now + 86_400_000)).toMatchObject({ allowed: 5 })
  })

  it('parallel consumers cannot both pass the same remaining budget', async () => {
    const { db } = createTestD1()
    const results = await Promise.all([consumeBudget(db, 'u1', 3, limits, now), consumeBudget(db, 'u1', 3, limits, now)])
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
