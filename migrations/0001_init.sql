-- 0001_init: full v1 schema (PLAN.md section 3, amended by "User decisions":
-- one card per word, no cards.direction, review_logs.direction kept) and by the
-- duplicate-handling spec docs/DUPLICATES.md section 10.2.
-- Timestamps are ms since epoch; ids are crypto.randomUUID(); languages are ISO 639-1.
-- D1 enforces foreign keys, so child rows use ON DELETE CASCADE where a parent can be deleted.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,          -- stored lowercased
  display_name  TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',    -- { theme, ttsAutoplay, studyDirection, hideSentenceOnFront }
  created_at    INTEGER NOT NULL
);

CREATE TABLE decks (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  source_lang   TEXT NOT NULL,
  target_lang   TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',    -- { dailyNewLimit, sentenceLevel, skipTopN }
  created_at    INTEGER NOT NULL
);
CREATE INDEX decks_user_id ON decks(user_id);

-- Global AI cache, shared by all users.
CREATE TABLE entries (
  id                    TEXT PRIMARY KEY,
  source_lang           TEXT NOT NULL,
  target_lang           TEXT NOT NULL,
  lemma                 TEXT NOT NULL,
  lemma_key             TEXT NOT NULL,
  sense_key             TEXT NOT NULL DEFAULT '',  -- glossKey(source_lang, hint) or ''
  pos                   TEXT,
  translation           TEXT,
  alt_translations_json TEXT,
  cefr                  TEXT,
  grammar_json          TEXT,
  example_target        TEXT,                  -- contains [[form]]
  example_source        TEXT,
  model                 TEXT,
  prompt_version        INTEGER,
  created_at            INTEGER NOT NULL,
  UNIQUE (source_lang, target_lang, lemma_key, sense_key)
);

CREATE TABLE entry_aliases (
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  input_side  TEXT NOT NULL CHECK (input_side IN ('target', 'source')),
  alias_key   TEXT NOT NULL,
  sense_key   TEXT NOT NULL DEFAULT '',
  entry_id    TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  PRIMARY KEY (source_lang, target_lang, input_side, alias_key, sense_key)
);

-- One card per word; both study directions share one FSRS schedule.
-- Identity of a resolved card is (deck_id, lemma_key, sense_key); see docs/DUPLICATES.md.
CREATE TABLE cards (
  id                      TEXT PRIMARY KEY,
  deck_id                 TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  entry_id                TEXT REFERENCES entries(id) ON DELETE SET NULL,
  input_term              TEXT NOT NULL,
  input_hint              TEXT,
  term_key                TEXT NOT NULL,
  input_lang              TEXT NOT NULL CHECK (input_lang IN ('target', 'source', 'auto')),
  input_side              TEXT CHECK (input_side IN ('target', 'source')),  -- known once resolved
  hint_key                TEXT NOT NULL DEFAULT '',  -- glossKey(source_lang, input_hint) or ''
  lemma_key               TEXT,                      -- termKey(target_lang, entry.lemma), set on resolution
  sense_key               TEXT,                      -- = hint_key, set on resolution
  extra_translations_json TEXT NOT NULL DEFAULT '[]', -- at most 10
  duplicate_of            TEXT REFERENCES cards(id) ON DELETE SET NULL,
  gen_claimed_at          INTEGER,                   -- 90 s lease used by /generate
  origin                  TEXT NOT NULL CHECK (origin IN ('import', 'suggested', 'manual')),
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'ready', 'failed', 'suspended', 'deleted', 'duplicate')),
  gen_attempts            INTEGER NOT NULL DEFAULT 0,
  gen_error               TEXT,
  override_json           TEXT,
  note                    TEXT,
  -- FSRS state (ts-fsrs Card)
  due                     INTEGER NOT NULL,
  stability               REAL NOT NULL DEFAULT 0,
  difficulty              REAL NOT NULL DEFAULT 0,
  elapsed_days            INTEGER NOT NULL DEFAULT 0,
  scheduled_days          INTEGER NOT NULL DEFAULT 0,
  learning_steps          INTEGER NOT NULL DEFAULT 0,
  reps                    INTEGER NOT NULL DEFAULT 0,
  lapses                  INTEGER NOT NULL DEFAULT 0,
  state                   INTEGER NOT NULL DEFAULT 0 CHECK (state IN (0, 1, 2, 3)), -- 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review             INTEGER,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);
CREATE INDEX cards_deck_status_state_due ON cards(deck_id, status, state, due);
-- Partial unique indexes: queries must repeat the predicate verbatim
-- (status NOT IN ('duplicate','deleted')) for SQLite to use them.
CREATE UNIQUE INDEX cards_input_uq ON cards(deck_id, input_lang, term_key, hint_key)
  WHERE status NOT IN ('duplicate', 'deleted');
CREATE UNIQUE INDEX cards_lemma_uq ON cards(deck_id, lemma_key, sense_key)
  WHERE lemma_key IS NOT NULL AND status NOT IN ('duplicate', 'deleted');
CREATE INDEX cards_term ON cards(deck_id, term_key);

-- Gloss keys per card (translation, alt/extra translations, hint), used for duplicate
-- detection and "Also in your deck". Rewritten when a card becomes ready, on
-- override/regenerate, and when its extra translations change.
CREATE TABLE card_glosses (
  deck_id   TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  gloss_key TEXT NOT NULL,
  card_id   TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  PRIMARY KEY (deck_id, gloss_key, card_id)
);
CREATE INDEX card_glosses_card_id ON card_glosses(card_id);

CREATE TABLE review_logs (
  id               TEXT PRIMARY KEY,           -- client-supplied UUID (idempotency key)
  card_id          TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating           INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  direction        TEXT NOT NULL CHECK (direction IN ('target-source', 'source-target')), -- side shown on the front
  state_before     INTEGER NOT NULL,
  due_before       INTEGER NOT NULL,
  stability_after  REAL NOT NULL,
  difficulty_after REAL NOT NULL,
  scheduled_days   INTEGER NOT NULL,
  reviewed_at      INTEGER NOT NULL,
  duration_ms      INTEGER
);
CREATE INDEX review_logs_card_id ON review_logs(card_id);
CREATE INDEX review_logs_user_reviewed_at ON review_logs(user_id, reviewed_at);

CREATE TABLE wordlist (
  lang      TEXT NOT NULL,
  rank      INTEGER NOT NULL,
  lemma     TEXT NOT NULL,
  lemma_key TEXT NOT NULL,
  pos       TEXT,
  PRIMARY KEY (lang, rank)
);
CREATE INDEX wordlist_lang_lemma_key ON wordlist(lang, lemma_key);

CREATE TABLE ai_usage (
  scope TEXT NOT NULL,                         -- 'global' or 'user:<id>'
  day   TEXT NOT NULL,                         -- YYYY-MM-DD (UTC)
  words INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, day)
);
