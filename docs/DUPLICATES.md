# PLAN §10: Duplicate handling

This is an amendment written by the architect and approved by the user as option (a). It overrides these parts of PLAN.md: §2 "Adding words" step 2, the cards indexes in §3, and the suggest query in §5.

## 10.1 Identity rule
A resolved card is identified by `(deck_id, lemma_key, sense_key)`:
- `lemma_key` = `termKey(target_lang, entry.lemma)`
- `sense_key` = the card's `hint_key`. That is `glossKey(source_lang, input_hint)`, or `''` if the user gave no hint.

Entries are cached under the same `(lemma_key, sense_key)`.

A new card N is a **duplicate** of a live card E if both are in the same deck, have the same `lemma_key`, and E's status is neither `duplicate` nor `deleted`, and any of these holds:
1. N has no hint.
2. `N.sense_key = E.sense_key`.
3. N's hint or main translation is one of E's glosses, or E's hint is one of N's glosses. Glosses are the glossKeys of: the translation, the alt translations, the extra translations, and the hint.

What this means in practice:
- Plain "Bank" after "Bank;bench" → duplicate.
- "Bank;bench" after plain "Bank" (which resolved to "bank") → separate card.
- "Bank;bench" + "Bank;bank" → 2 cards.
- "Bank;Bench" after "Bank;bench" → duplicate.
- "big" + "large" (both groß) → one of them is a duplicate.
- "to begin" → beginnen and → anfangen → 2 cards, linked by "Also in your deck".

The check runs when a card is resolved, against cards that are already resolved, in `created_at` order. If cards resolve out of order (rare), we accept the result, because it is always reported.

Deleted cards are never duplicate targets, so re-importing a deleted word creates a fresh card. `/suggest` still skips deleted words.

`glossKey(lang, s)` does, in order: NFC normalization, lowercase, trim, drop `(...)`, strip the language's `glossStripPrefixes` (English: `to `, `a `, `an `, `the `), collapse whitespace.

## 10.2 Schema diff (goes into `0001_init.sql`)
```diff
 entries(... sense_key DEFAULT '' ...)   -- sense_key = glossKey(source_lang, hint) or ''
-entry_aliases(source_lang, target_lang, alias_key, sense_key, entry_id FK,
-  PRIMARY KEY(source_lang, target_lang, alias_key, sense_key))
+entry_aliases(source_lang, target_lang, input_side CHECK IN ('target','source'),
+  alias_key, sense_key, entry_id FK,
+  PRIMARY KEY(source_lang, target_lang, input_side, alias_key, sense_key))
+  -- after each resolution, INSERT OR IGNORE (input_side, term_key, hint_key) and ('target', lemma_key, sense_key)
 cards(id PK, deck_id FK, entry_id FK NULL, input_term, input_hint NULL, term_key,
+  input_lang CHECK IN ('target','source','auto') NOT NULL,
+  input_side CHECK IN ('target','source') NULL,
+  hint_key NOT NULL DEFAULT '',
+  lemma_key NULL, sense_key NULL,
+  extra_translations_json NOT NULL DEFAULT '[]',   -- at most 10
+  duplicate_of NULL REFERENCES cards(id),
+  gen_claimed_at NULL,                             -- 90 s lease used by /generate
   origin ...,
-  status CHECK IN ('pending','ready','failed','suspended','deleted'),
+  status CHECK IN ('pending','ready','failed','suspended','deleted','duplicate'),
   ...
-  UNIQUE(deck_id, term_key))
+  )
   INDEX(deck_id, status, state, due)
-  UNIQUE INDEX(deck_id, entry_id) WHERE entry_id IS NOT NULL
+  UNIQUE INDEX cards_input_uq ON cards(deck_id, input_lang, term_key, hint_key)
+    WHERE status NOT IN ('duplicate','deleted')
+  UNIQUE INDEX cards_lemma_uq ON cards(deck_id, lemma_key, sense_key)
+    WHERE lemma_key IS NOT NULL AND status NOT IN ('duplicate','deleted')
+  INDEX cards_term ON cards(deck_id, term_key)
+card_glosses(deck_id, gloss_key, card_id FK, PRIMARY KEY(deck_id, gloss_key, card_id))  INDEX(card_id)
+  -- rewrite when a card becomes ready, on override or regenerate, and when its extra translations change
```
For SQLite to use these partial indexes, every query must repeat the index predicate word for word: `status NOT IN ('duplicate','deleted')`.

AI `Item` schema changes:
- add `input_side: 'target'|'source'`
- also wrap the translated word in `example_source` with `[[ ]]`

## 10.3 Import (`POST /import`; `/suggest` inserts use the same path)
```
rows = parseImport(text); r.lang=inputLang; r.termKey=termKey(...); r.hintKey = hint ? glossKey(src,hint) : ''
1. within-file dupes: drop r if an earlier s has compatLang(s,r) && s.termKey==r.termKey
   && (r.hintKey=='' || r.hintKey==s.hintKey) → report 'in_file'
2. alias lookup (chunks of ≤90 keys): sides = auto ? both : [lang]; use the hit only if exactly one entry matches
3. load candidates: live cards WHERE term_key IN (...) OR lemma_key IN (lemma_keys of the alias hits), plus their glosses
4. per row: E = live card with compatLang && term_key==r.termKey && (r.hintKey=='' || E.hint_key==r.hintKey)
            ?? (r.entry && findDuplicate(r, r.entry))
   if E: mergeTranslation(E, r); report 'in_deck'; continue
   insert: alias hit → 'ready' (entry_id, lemma_key, sense_key, input_side, glosses), otherwise 'pending'
5. multi-row INSERT OR IGNORE ... RETURNING id (≤7 rows per statement), all in one db.batch;
   an ignored row → report 'in_deck' pointing to the card that won
compatLang(a,b) = a==b || a=='auto' || b=='auto'
sourceWord(r) = side=='source' ? r.term : r.hint
mergeTranslation(E,r): w=sourceWord(r); if w && glossKey(w) ∉ glosses(E) && extras<10:
   UPDATE cards SET extra_translations_json=json_insert(extra_translations_json,'$[#]',?)
     WHERE id=? AND NOT EXISTS (SELECT 1 FROM json_each(extra_translations_json) WHERE value=?)
   INSERT OR IGNORE card_glosses; addedTranslation=w   (otherwise addedTranslation=null)
```

## 10.4 Generate (`POST /generate`)
```
claimed = UPDATE cards SET gen_claimed_at=:now WHERE id IN (SELECT id FROM cards WHERE deck_id=? AND status='pending'
            AND (gen_claimed_at IS NULL OR gen_claimed_at < :now-90000) ORDER BY created_at LIMIT 10) RETURNING *
alias lookup for each card; cache misses → rate limit → one AI call → per item:
  not_a_word → failed
  ok → INSERT entries ON CONFLICT DO NOTHING; SELECT the winning row; INSERT OR IGNORE aliases
batchSeen = {}
for c in claimed, in created_at order, that has an entry:
  E = batchSeen match ?? findDuplicate(c, c.entry); if E: markDuplicate(c,E); continue
  res = UPDATE cards SET entry_id, lemma_key, sense_key=c.hint_key, input_side, status='ready', gen_claimed_at=NULL
        WHERE id=:c AND status='pending' AND NOT EXISTS (SELECT 1 FROM cards e WHERE e.deck_id=:d
          AND e.lemma_key=:lk AND e.id<>:c AND e.status NOT IN ('duplicate','deleted') AND (:sk='' OR e.sense_key=:sk))
  if res.meta.changes==0: re-read; if still pending: markDuplicate(c, findDuplicate(...))
  else: write card_glosses; batchSeen.add(c)
markDuplicate(c,E): UPDATE cards SET status='duplicate', duplicate_of=E.id, entry_id, lemma_key, sense_key,
  gen_claimed_at=NULL WHERE id=c AND status='pending'; mergeTranslation(E,c); report 'resolved'
```
The unique index `cards_lemma_uq` is only a backstop. If it ever fires, catch the error and process the cards one at a time.

## 10.5 Concurrency (D1)
D1 has no interactive transactions, so every guard has to live inside a single statement:
- `INSERT OR IGNORE` against the partial unique indexes
- `UPDATE … WHERE status='pending' AND NOT EXISTS(…)`, then check `meta.changes`
- an idempotent `json_insert`

What happens in each race:
- **Two parallel `/generate` calls:** the lease means each card gets one AI call. If a Worker dies, its lease expires after 90 s.
- **Same lemma resolved in two parallel calls:** one card becomes `ready`, the other `duplicate`.
- **Two parallel imports:** the rows that lose the `INSERT OR IGNORE` are reported as duplicates. A row with a hint racing a row without one gets past the input index, and the check after the AI call catches it.
- **`entries` stays untouched.** Extra translations live only in `cards.extra_translations_json` and `card_glosses`.

## 10.6 API shapes
```ts
type DuplicateReport = { input: string; hint?: string; line?: number;
  reason: 'in_file' | 'in_deck' | 'resolved';
  existing: { id: string; display: string; status: CardStatus };
  addedTranslation: string | null };
POST /import   -> { added, ready, pending, invalid: {line, term, reason}[], duplicates: DuplicateReport[] }
POST /suggest  -> { added, exhausted, pending, duplicates: DuplicateReport[] }
POST /generate -> { ...existing, duplicates: DuplicateReport[] }   // duplicates count toward `processed`
Card DTO       += extraTranslations: string[]; duplicateOf?: {id, display};
                  alsoInDeck: {id, display}[]   // ≤3; only in /learn, /review, GET /cards/:id
GET /cards?status=duplicate
```
- `alsoInDeck` = other `ready` cards that share a `card_glosses.gloss_key` with this card. Fetch it with one self-join per batch.
- Leave duplicates out of stats, learn, review, retry-failed, and the default card list.

## 10.7 `/suggest`
Pick the next `count` words with `DISTINCT lemma_key` and rank > `skipTopN`, excluding any lemma_key that is:
- in `(SELECT lemma_key FROM cards WHERE deck_id=? AND lemma_key IS NOT NULL)` (cards in any status), or
- in `(SELECT term_key FROM cards WHERE deck_id=? AND input_lang<>'source')`

Then:
- Insert each word with `origin='suggested'`, `input_lang='target'`, and no hint, then run the §10.3 and §10.4 steps.
- If duplicates show up after the AI call, report them. v1 does not top up the shortfall.
- AI fallback: exclude at most 500 lemma_keys, ask for count×1.2 words, and apply the same filter.

## 10.8 UI copy
- **Summary:** "Added 18 words · 3 already in your deck · 1 couldn't be read". Leave out any part that is zero.
- **Collapsible "3 already in your deck":** each line links to the existing card.
  - "large → groß: already in your deck, added as a translation"
  - "der Hund: already in your deck"
  - "Hund (line 7): listed twice in this import"
  - "Katze: already in your deck (generation failed, retry it from Words)"
- **Home banner:** "2 words were already in your deck · View" opens `?status=duplicate`.
- **Card back:** "big · also: large".
- **"Also in your deck" line:** "Also in your deck: anfangen, der Anfang".
  - Shows on EN→DE backs, on Mixed cards shown English first, and on Learn intro cards.
  - Hidden when the list is empty, and never shown in DE→EN.
- **EN→DE front:** always shows `example_source` with the highlight. `hideSentenceOnFront` applies to DE→EN only.

## 10.9 Milestones & acceptance tests
**M2:** the full §10.2 schema in migration 0001.

**M3:** `hint_key`/`input_lang`, the in-file and term-key checks, `INSERT OR IGNORE` with reporting, and the summary UI.
- `der Hund\nHund\nKatze;cat\n# comment\n\ngehen` → 3 cards, 1 `in_file` duplicate (line 2).
- `Bank;bench\nBank;bank` → 2 cards.
  - Re-import `Bank` → 0 added, 1 duplicate pointing to the `Bank;bench` card.
  - Re-import `Bank;Bench` → duplicate.
- `Gift` (target) + `gift` (source) → 2 cards.
- Delete `Hund`, then re-import it → 1 card added.
- Two identical imports run in parallel → one set of cards, and the `added` counts sum to the number of unique rows.

**M4** (fake provider):
- `Hund` is ready; importing `dog` (source) and generating gives:
  - the dog card becomes `duplicate` → Hund
  - Hund's extras are `['dog']`
  - `addedTranslation='dog'`
  - `entries` is unchanged
- `big\nlarge` → 1 ready groß card and 1 duplicate.
- User B has cached `ging`. User A, who has `gehen`, imports `ging` → import-time duplicate, 0 AI calls, no row inserted.
- Plain `Bank` (resolved to bank), then `Bank;bench` → 2 ready cards. Then `Bank;bank` → duplicate with `addedTranslation=null`.
- Two parallel `/generate` calls → exactly 1 AI call.
- Same lemma in parallel calls → 1 ready and 1 duplicate, with no constraint error.
- Duplicates are excluded from stats, learn, review, and retry-failed.

**M5:**
- beginnen and anfangen each list the other in `alsoInDeck`.
- "to begin" and "begin" are treated as matching.
- The "Also in your deck" line is shown in EN→DE and hidden in DE→EN.
- The EN→DE front shows `example_source` even when `hideSentenceOnFront` is on.

**M6:** intro cards show "Also in your deck".

**M7:**
- `/suggest` never returns a lemma that is already in the deck, whatever its status. Once `dog` has resolved to Hund, Hund is not suggested.
- Duplicates found after the AI call are reported.

**M8:** editing `extraTranslations` rewrites `card_glosses`.
