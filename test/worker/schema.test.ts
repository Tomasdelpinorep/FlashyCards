import { describe, expect, it } from 'vitest'
import { createTestD1 } from '../helpers/d1'

// Sanity checks for migrations/0001_init.sql (docs/DUPLICATES.md section 10.2). No duplicate logic here.
function seed() {
  const { sqlite } = createTestD1()
  sqlite.exec(`INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@x.com', 0);
               INSERT INTO decks (id, user_id, name, source_lang, target_lang, created_at) VALUES ('d1', 'u1', 'G', 'en', 'de', 0);`)
  const insert = sqlite.prepare(`INSERT INTO cards (id, deck_id, input_term, term_key, input_lang, hint_key, lemma_key, sense_key,
      origin, status, due, created_at, updated_at) VALUES (?, 'd1', ?, ?, ?, ?, ?, ?, 'import', ?, 0, 0, 0)`)
  return { sqlite, insert }
}

describe('0001_init schema', () => {
  it('cards_input_uq: unique per (deck, input_lang, term_key, hint_key) among live cards only', () => {
    const { insert } = seed()
    insert.run('c1', 'Bank', 'bank', 'target', 'bench', null, null, 'pending')
    insert.run('c2', 'Bank', 'bank', 'target', '', null, null, 'pending') // different hint_key
    insert.run('c3', 'bank', 'bank', 'source', 'bench', null, null, 'pending') // different input_lang
    expect(() => insert.run('c4', 'Bank', 'bank', 'target', 'bench', null, null, 'pending')).toThrow(/UNIQUE/)
    insert.run('c5', 'Bank', 'bank', 'target', 'bench', null, null, 'duplicate')
    insert.run('c6', 'Bank', 'bank', 'target', 'bench', null, null, 'deleted')
  })

  it('cards_lemma_uq: unique per (deck, lemma_key, sense_key) among live resolved cards only', () => {
    const { insert } = seed()
    insert.run('c1', 'big', 'big', 'source', '', 'gross', '', 'ready')
    expect(() => insert.run('c2', 'large', 'large', 'source', '', 'gross', '', 'ready')).toThrow(/UNIQUE/)
    insert.run('c3', 'large', 'large', 'source', '', 'gross', '', 'duplicate')
    insert.run('c4', 'Bank', 'bank', 'target', 'bench', 'bank', 'bench', 'ready')
  })

  it("accepts the 'duplicate' status, cascades deck deletion to cards and glosses", () => {
    const { sqlite, insert } = seed()
    insert.run('c1', 'Hund', 'hund', 'target', '', 'hund', '', 'ready')
    insert.run('c2', 'dog', 'dog', 'source', '', 'hund', '', 'duplicate')
    sqlite.exec(`UPDATE cards SET duplicate_of = 'c1' WHERE id = 'c2';
                 INSERT INTO card_glosses (deck_id, gloss_key, card_id) VALUES ('d1', 'dog', 'c1');`)
    sqlite.exec(`DELETE FROM decks WHERE id = 'd1'`)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM cards').get()).toMatchObject({ n: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM card_glosses').get()).toMatchObject({ n: 0 })
  })

  it('has input_side in the entry_aliases primary key', () => {
    const { sqlite } = seed()
    sqlite.exec(`INSERT INTO entries (id, source_lang, target_lang, lemma, lemma_key, created_at) VALUES ('e1', 'en', 'de', 'Gift', 'gift', 0);
                 INSERT INTO entry_aliases (source_lang, target_lang, input_side, alias_key, sense_key, entry_id) VALUES ('en', 'de', 'target', 'gift', '', 'e1');
                 INSERT INTO entry_aliases (source_lang, target_lang, input_side, alias_key, sense_key, entry_id) VALUES ('en', 'de', 'source', 'gift', '', 'e1');`)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM entry_aliases').get()).toMatchObject({ n: 2 })
  })
})
