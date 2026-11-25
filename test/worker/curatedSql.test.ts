/** scripts/curated-to-sql.ts on small fixtures (the real dictionary: curated.test.ts). */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { curatedDeltaSql, curatedToSql } from '../../scripts/curated-to-sql'
import { buildCurated } from '../../src/worker/ai/curated.de'
import { DEV_LEXICON_DE, type DevEntry } from '../../src/worker/ai/devLexicon.de'
import { createTestD1 } from '../helpers/d1'

const pick = (...lemmas: string[]) => lemmas.map((l) => structuredClone(DEV_LEXICON_DE.find((e) => e.lemma === l)!))
const gehen: DevEntry = { ...pick('lernen')[0]!, lemma: 'gehen', translation: 'to go', alt_translations: ['to walk'], example_target: 'Wir [[gehen]] nach Hause.', example_source: 'We are [[going]] home.' }

function apply(sql: string): DatabaseSync {
  const { sqlite } = createTestD1()
  sqlite.exec(sql)
  return sqlite
}

describe('curatedToSql', () => {
  it('writes deterministic curated entries and target/source aliases', () => {
    const out = curatedToSql(pick('Kind', 'sich freuen'), ['Kind', 'freuen'])
    expect(out).toMatchObject({ entries: 2, conflicts: [] })
    expect(curatedToSql(pick('Kind', 'sich freuen'), ['Kind', 'freuen']).sql).toBe(out.sql)
    const db = apply(out.sql)
    expect(db.prepare('SELECT id, lemma, model, prompt_version FROM entries ORDER BY id').all().map((r) => ({ ...r }))).toEqual([
      { id: 'cur-de-kind', lemma: 'Kind', model: 'curated', prompt_version: 3 },
      { id: 'cur-de-sich freuen', lemma: 'sich freuen', model: 'curated', prompt_version: 3 },
    ])
    const aliases = db.prepare('SELECT input_side, alias_key, entry_id FROM entry_aliases ORDER BY input_side, alias_key').all().map((r) => ({ ...r }))
    expect(aliases).toEqual([
      { input_side: 'source', alias_key: 'be glad', entry_id: 'cur-de-sich freuen' },
      { input_side: 'source', alias_key: 'be happy', entry_id: 'cur-de-sich freuen' },
      { input_side: 'source', alias_key: 'child', entry_id: 'cur-de-kind' },
      { input_side: 'source', alias_key: 'kid', entry_id: 'cur-de-kind' },
      { input_side: 'source', alias_key: 'look forward to', entry_id: 'cur-de-sich freuen' },
      { input_side: 'source', alias_key: 'to be glad', entry_id: 'cur-de-sich freuen' },
      { input_side: 'source', alias_key: 'to be happy', entry_id: 'cur-de-sich freuen' },
      { input_side: 'source', alias_key: 'to look forward to', entry_id: 'cur-de-sich freuen' },
      { input_side: 'target', alias_key: 'freuen', entry_id: 'cur-de-sich freuen' },
      { input_side: 'target', alias_key: 'kind', entry_id: 'cur-de-kind' },
      { input_side: 'target', alias_key: 'sich freuen', entry_id: 'cur-de-sich freuen' },
    ])
  })

  it('upserts over a stale row of the same lemma, keeping its id', () => {
    const { sqlite } = createTestD1()
    sqlite.exec(
      "INSERT INTO entries (id, source_lang, target_lang, lemma, lemma_key, sense_key, translation, model, created_at) VALUES ('old', 'en', 'de', 'Kind', 'kind', '', 'kiddo', 'fake', 1)",
    )
    sqlite.exec("INSERT INTO entry_aliases VALUES ('en', 'de', 'target', 'kind', '', 'old')")
    sqlite.exec(curatedToSql(pick('Kind'), ['Kind']).sql)
    expect({ ...sqlite.prepare('SELECT id, translation, model FROM entries').get() }).toEqual({ id: 'old', translation: 'child', model: 'curated' })
    expect(sqlite.prepare("SELECT entry_id FROM entry_aliases WHERE alias_key = 'child'").get()).toMatchObject({ entry_id: 'old' })
  })

  it('a primary translation beats an alternative (reported); then the lower rank wins', () => {
    const out = curatedToSql([...pick('fahren'), gehen], ['fahren', 'gehen'])
    expect(out.conflicts).toContain('source "go": gehen (primary, rank 2) beats fahren (alt, rank 1)')
    const db = apply(out.sql)
    expect(db.prepare("SELECT entry_id FROM entry_aliases WHERE alias_key = 'to go'").get()).toMatchObject({ entry_id: 'cur-de-gehen' })
    const walk = { ...gehen, lemma: 'laufen', translation: 'to run', alt_translations: ['to walk'] }
    const out2 = curatedToSql([walk, gehen], ['gehen', 'laufen'])
    expect(out2.conflicts).toContain('source "walk": gehen (alt, rank 1) beats laufen (alt, rank 2)')
  })

  it('fails on a duplicate lemma, a listed lemma without an entry, or an entry post-validation would change', () => {
    const [kind] = pick('Kind')
    expect(() => curatedToSql([kind!, { ...kind!, lemma: 'Kinder' }], ['Kind', 'Kinder', 'kinder'])).not.toThrow()
    expect(() => curatedToSql([kind!, { ...kind! }], ['Kind'])).toThrow(/duplicate lemma key "kind"/)
    expect(() => curatedToSql([kind!], ['Kind', 'Zwetschge'])).toThrow(/"Zwetschge" has no entry/)
    expect(() => curatedToSql([{ ...kind!, grammar: { ...kind!.grammar!, article: 'der' } }], ['Kind'])).toThrow(/post-validation changes grammar/)
    expect(() => curatedToSql([{ ...kind!, translation: '' }], ['Kind'])).toThrow(/Kind/)
  })

  it('a delta has only the new entries and the alias rows that are new or moved; base + delta = the whole', () => {
    const base = { entries: pick('Kind', 'fahren'), lemmas: ['Kind', 'fahren'] }
    const next = { entries: [...pick('Kind', 'fahren'), gehen], lemmas: ['Kind', 'fahren'] }
    const d = curatedDeltaSql(base, next, 'UPDATE cards SET gen_error = NULL WHERE 0;')
    expect(d).toMatchObject({ entries: 1 })
    expect(d.sql).toContain("'cur-de-gehen'")
    expect(d.sql).not.toContain("'cur-de-kind'")
    expect(d.sql.trimEnd().endsWith('UPDATE cards SET gen_error = NULL WHERE 0;')).toBe(true)
    const staged = apply(curatedToSql(base.entries, base.lemmas).sql)
    expect(staged.prepare("SELECT entry_id FROM entry_aliases WHERE alias_key = 'go'").get()).toMatchObject({ entry_id: 'cur-de-fahren' })
    staged.exec(d.sql)
    const aliases = (db: DatabaseSync) => db.prepare('SELECT input_side, alias_key, entry_id FROM entry_aliases ORDER BY 1, 2').all().map((r) => ({ ...r }))
    expect(aliases(staged)).toEqual(aliases(apply(curatedToSql(next.entries, next.lemmas).sql)))
    expect(staged.prepare("SELECT entry_id FROM entry_aliases WHERE alias_key = 'go'").get()).toMatchObject({ entry_id: 'cur-de-gehen' })
    expect(() => curatedDeltaSql(next, base)).toThrow(/entry "gehen" was removed/)
  })

  it('key variants: no final punctuation, ASCII apostrophes, no "sich "; a variant yields to a real target key', () => {
    const [kind] = pick('Kind')
    const sorry: DevEntry = {
      ...kind!,
      lemma: 'Es tut mir leid.',
      pos: 'phrase',
      translation: 'I’m sorry',
      alt_translations: [],
      grammar: { ...kind!.grammar!, gender: null, article: null, plural: null, genitive: null },
      example_target: '[[Es tut mir leid]], dass ich zu spät komme.',
      example_source: '[[I’m sorry]] I’m late.',
    }
    const [lernen] = pick('lernen')
    const sichLernen: DevEntry = { ...lernen!, lemma: 'sich lernen' }
    const keys = (sql: string) => apply(sql).prepare("SELECT input_side || ':' || alias_key AS k, entry_id FROM entry_aliases ORDER BY 1").all().map((r) => ({ ...r }))
    const without = keys(curatedToSql([sorry], []).sql)
    expect(without.map((r) => r.k)).toEqual(['source:i’m sorry', 'target:es tut mir leid.'])
    const out = curatedToSql([sorry, lernen!, sichLernen], [], { keyVariants: true })
    const rows = keys(out.sql)
    expect(rows).toEqual(
      expect.arrayContaining([
        { k: "source:i'm sorry", entry_id: 'cur-de-es tut mir leid.' },
        { k: 'target:es tut mir leid', entry_id: 'cur-de-es tut mir leid.' },
        { k: 'target:lernen', entry_id: 'cur-de-lernen' }, // the real key beats sich lernen's variant, silently
        { k: 'target:sich lernen', entry_id: 'cur-de-sich lernen' },
      ]),
    )
    const aliased = keys(curatedToSql([lernen!], [], { targetAliases: { 'sich lernen': 'lernen' } }).sql)
    expect(aliased).toContainEqual({ k: 'target:sich lernen', entry_id: 'cur-de-lernen' })
    expect(() => curatedToSql([lernen!], [], { targetAliases: { x: 'Zwetschge' } })).toThrow(/no entry "Zwetschge"/)
  })

  it('buildCurated rejects duplicate lemma keys', () => {
    expect(() => buildCurated([pick('Kind'), pick('Kind')])).toThrow(/duplicate lemma key "kind"/)
  })
})
