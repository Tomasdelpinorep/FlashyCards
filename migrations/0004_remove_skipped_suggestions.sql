-- One-off cleanup: cards that "Add new words" suggested before the skip list existed
-- (languages.ts suggestSkipLemmas: pronouns, articles, ja/nein...). Same soft delete as
-- db/cards.ts softDeleteCard, so suggest keeps excluding them. Words the user typed are kept.
DELETE FROM card_glosses WHERE card_id IN (
  SELECT c.id FROM cards c JOIN decks d ON d.id = c.deck_id
  WHERE d.target_lang = 'de' AND c.origin = 'suggested' AND c.input_lang = 'target'
    AND c.term_key IN ('ich','sie','der','du','es','wir','er','ein','ja','ihr','nein','sich','man')
);

UPDATE cards SET status = 'deleted', gen_claimed_at = NULL,
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE status <> 'deleted' AND origin = 'suggested' AND input_lang = 'target'
  AND term_key IN ('ich','sie','der','du','es','wir','er','ein','ja','ihr','nein','sich','man')
  AND deck_id IN (SELECT id FROM decks WHERE target_lang = 'de');
