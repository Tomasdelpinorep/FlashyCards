# Flashcards app: architecture plan (v1)

This is the source of truth for implementation. The architect agent wrote it, and the user's decisions are folded in (see "User decisions"). If you need to deviate, note it in `docs/DECISIONS.md` together with the reason.

## User decisions (override anything below)
- **AI provider:** Claude Haiku 5.5 (`claude-haiku-5-5`) through `@anthropic-ai/sdk`.
- **Card model:** ONE card per word, holding both the German side (word, article, plural, sentence) and the English side (translation, sentence translation).
  - Training can be done in either direction. The session direction is picked on the Train/Learn screen: **German→English, English→German, or Mixed** (random per card). The last choice is remembered in user settings.
  - Each card has a single FSRS schedule, shared by both directions.
  - Drop the `direction` column and remove it from the unique indexes. The unique index becomes `(deck_id, term_key)`.
- **Example sentence level:** default **A1–A2** (`decks.settings_json.sentenceLevel = 'A1-A2'`). Sentences should be short and simple, 5–10 words.
- **Auth:** Cloudflare Access (email allowlist, one-time PIN), with JWT verification in the Worker.
- **Duplicates:** judged by the TARGET-language word. Homographs are separate cards only when the user gave different meaning hints. The full spec is in **`docs/DUPLICATES.md` (§10)**. It overrides the cards indexes in §3, step 2 of the "Adding words" flow in §2, and the suggest query in §5.

## 1. Decisions
| Area | Choice |
|---|---|
| Stack | TypeScript. React 19 + Vite + Tailwind v4 for the frontend. Hono + Zod for the API. Raw SQL on D1. `ts-fsrs`. TanStack Query. Vitest. |
| Hosting | One Cloudflare Worker serving the static SPA plus `/api`, with D1, built through `@cloudflare/vite-plugin`. Cost: $0. |
| AI | Claude Haiku 5.5 with structured outputs (`client.messages.parse` + `zodOutputFormat`). Do not send `temperature`. Thinking is disabled. Expected cost is under $0.50 per 3k words. |
| Auth | Cloudflare Access plus JWT verification (`jose`, team JWKS, `aud`, `ALLOWED_EMAILS`). A dev bypass via `DEV_AUTH_EMAIL` is allowed only on localhost. |
| SRS | FSRS (`ts-fsrs`): retention 0.9, maximum interval 365 days, fuzz on, learning steps 1m and 10m, relearning step 10m. |
| Language pair | Stored per deck (`source_lang`, `target_lang`). Language-specific logic lives only in `src/shared/languages.ts`. |
| "Add X words" | Words come from a bundled, lemmatized frequency list (`wordlist` table) in rank order, excluding words already in the deck. If a language has no list, ask the AI instead. |

## 2. Architecture
Requests flow: Browser SPA (PWA) → Cloudflare Access → Worker (Hono).
- The Worker serves the static assets with SPA fallback.
- `/api/*` goes through `authMiddleware`, then the routes: me, decks, import, suggest, generate, cards, learn, review.
- Services: `importParser`, `normalize`, `generation` (cache, then AI), `suggest`, `srs`, `rateLimit`.
- `ai/` defines a `SentenceGenerator` interface with two implementations: `AnthropicGenerator` and `FakeGenerator` (deterministic, used when `AI_PROVIDER=fake`, or locally when `AI_PROVIDER` is unset and there is no key; otherwise a missing key fails closed, see DECISIONS.md M5).
- D1 holds `users`, `decks`, `cards`, `review_logs`, `entries` (a global AI cache), `entry_aliases`, `wordlist`, and `ai_usage`.

**Adding words:**
1. The client sends text or a count.
2. The Worker inserts `pending` cards. Duplicates are skipped through the unique index on `(deck_id, term_key)`.
3. The client calls `POST /generate` in a loop. Each call handles up to 10 pending cards: cache hits on `entry_aliases` cost nothing, and cache misses are sent to Haiku as one batched call, subject to the rate limit. Processed cards become `ready`.
4. The dashboard resumes any pending generation.

**Reviews:**
- `POST /reviews` is idempotent through a client-supplied UUID. The FSRS update plus the log entry run as one `db.batch()`.
- Cards still in learning that come due during the session are requeued on the client.

## 3. Data model (D1)
Timestamps are milliseconds since the epoch. IDs come from `crypto.randomUUID()`. Languages use ISO 639-1 codes.

```sql
users(id PK, email UNIQUE NOT NULL, display_name, settings_json DEFAULT '{}', created_at)
  -- settings: { theme, ttsAutoplay, studyDirection: 'target-source'|'source-target'|'mixed', hideSentenceOnFront }
decks(id PK, user_id FK, name, source_lang, target_lang,
      settings_json DEFAULT '{}',  -- { dailyNewLimit:10, sentenceLevel:'A1-A2', skipTopN:0 }
      created_at)  INDEX(user_id)
entries(id PK, source_lang, target_lang, lemma, lemma_key, sense_key DEFAULT '',
  pos, translation, alt_translations_json, cefr, grammar_json,
  example_target /* contains [[form]] */, example_source, model, prompt_version, created_at,
  UNIQUE(source_lang, target_lang, lemma_key, sense_key))
entry_aliases(source_lang, target_lang, alias_key, sense_key, entry_id FK,
  PRIMARY KEY(source_lang, target_lang, alias_key, sense_key))
cards(id PK, deck_id FK, entry_id FK NULL, input_term, input_hint NULL, term_key,
  origin CHECK IN ('import','suggested','manual'),
  status CHECK IN ('pending','ready','failed','suspended','deleted'),
  gen_attempts DEFAULT 0, gen_error NULL, override_json NULL, note NULL,
  due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
  reps, lapses, state /*0 New,1 Learning,2 Review,3 Relearning*/, last_review NULL,
  created_at, updated_at,
  UNIQUE(deck_id, term_key))
  INDEX(deck_id, status, state, due)
  UNIQUE INDEX(deck_id, entry_id) WHERE entry_id IS NOT NULL
review_logs(id PK /*client UUID*/, card_id FK, user_id, rating, direction /*which side was shown*/,
  state_before, due_before, stability_after, difficulty_after, scheduled_days, reviewed_at, duration_ms)
  INDEX(card_id), INDEX(user_id, reviewed_at)
wordlist(lang, rank, lemma, lemma_key, pos, PRIMARY KEY(lang, rank))  INDEX(lang, lemma_key)
ai_usage(scope, day /*YYYY-MM-DD UTC*/, words, calls, PRIMARY KEY(scope, day))
```

`LanguageConfig` (in `src/shared/languages.ts`) has these fields:
- `code`, `name`, `ttsLang`
- `articles[]`
- `genderColors?`
- `grammarPromptHints`
- `hasWordlist`

`termKey(lang, s)` normalizes a term in this order: NFC, trim, collapse whitespace, strip a leading article, strip plural notation, lowercase.

D1 accepts at most **100 bound parameters per statement**, so chunk multi-row inserts.

## 4. API (all under `/api`; Zod-validated; auth required; deck ownership checked; Hono RPC client)
- `GET /me` returns the user and their decks. On first login it creates a default en→de deck. `PATCH /me` updates settings.
- `GET /languages`
- `POST /decks`, `PATCH /decks/:id`, `DELETE /decks/:id`, `GET /decks/:id/stats` (returns new, learning, dueNow, dueToday, review, pending, failed, total, reviewedToday, newToday)
- `POST /decks/:id/import` takes `{text, filename?, inputLang:'target'|'source'|'auto'}` with at most 500 rows. It returns `{added, duplicates, invalid, pending}`.
- `POST /decks/:id/suggest` takes `{count:1..50}` and returns `{added, exhausted, pending}`.
- `POST /decks/:id/generate` returns `{processed, fromCache, generated, failed, remaining, rateLimited, limitResetsAt?}`.
- `POST /decks/:id/retry-failed`
- `GET /decks/:id/cards` accepts `?status&q&cursor&limit`.
- `GET /decks/:id/learn` accepts `?limit`, capped by `dailyNewLimit` minus `newToday`.
- `GET /decks/:id/review` accepts `?limit=50&ahead=0`. Learn-ahead is 20 minutes. `ahead=1` means "practice anyway".
- `GET /cards/:id`, `PATCH /cards/:id` (note, override, suspend), `DELETE /cards/:id` (soft delete), `POST /cards/:id/regenerate` (writes to `override_json` only)
- `POST /reviews` takes `{id:uuid, cardId, rating:1..4, direction, reviewedAt, durationMs}`. If the UUID was already used, it returns the current card. `reviewedAt` is clamped to between now minus 7 days and now.

**Rate limit:** only cache misses count. Each user gets 200 words per day (`AI_USER_DAILY_LIMIT`), and the whole app gets 2000 per day (`AI_GLOBAL_DAILY_LIMIT`).

**Import parsing** happens in `src/shared/parseImport.ts`, which the client also uses for its preview:
- One entry per line. Skip blank lines and lines starting with `#`.
- The delimiter is a tab, `;`, or `|`. Use `,` only for CSV files.
- Column 1 is the term. Column 2 is an optional hint or translation.
- Skip a header row.
- Terms longer than 100 characters are invalid.

## 5. AI prompts
- The system prompt is templated with the source and target language names and the level. For each item it asks for:
  - the lemma in the target language (when the input is in the source language, choose the most common equivalent)
  - a short translation and up to 3 alternative translations
  - ONE natural example sentence at the deck's level (A1–A2 means 5–10 simple words), with the exact form of the word wrapped in `[[ ]]`, plus a natural translation of the sentence
  - grammar fields filled from `grammarPromptHints`, using null when the model is unsure
  - `status: "not_a_word"` for junk input
  - the original input echoed back, with items kept in input order
- **German grammar hints:**
  - nouns: gender, article, plural with its article, irregular genitive
  - verbs: present 3rd person singular, Präteritum 3rd person singular, past participle, auxiliary, whether it is separable, whether it is reflexive, which case it governs
  - adjectives: irregular comparative and superlative forms
  - prepositions: which case they govern
- **Output schema (Zod):**
  - The batch is `{items: Item[]}`.
  - `Item` has: `input`, `status` (`ok` or `not_a_word`), `lemma`, `pos` (an enum), `translation`, `alt_translations[]`, `cefr`, `grammar` (all fields nullable: `gender`, `article`, `plural`, `genitive`, `verb{...}`, `governs_case`, `comparative`, `superlative`, `note`), `example_target`, `example_source`.
- **Post-validation:**
  - Match outputs to inputs by `input`, falling back to position.
  - The article must agree with the gender.
  - If `[[ ]]` is missing, show the sentence without highlighting.
- Failure handling:
  - On a 429 or 5xx, the card stays pending and `gen_attempts` goes up by 1.
  - After 3 attempts the card is marked `failed`.
- Set the constant `PROMPT_VERSION = 1`.
- **Word list (M7):** `scripts/build-wordlist.ts` takes the top ~8k tokens of hermitdave/FrequencyWords `de_50k.txt` (CC-BY-SA-4.0; credit it) and has Haiku lemmatize and filter them in chunks of 200. The result is about 5k lemmas in `data/wordlists/de.json`. `scripts/wordlist-to-sql.ts` then generates `migrations/0002_wordlist_de.sql`.
- **Suggest query:** take the next `count` words with rank above `skipTopN` whose `lemma_key` is not already in the deck's `term_key`s (including deleted cards).

## 6. Frontend
- **Layout:** mobile-first, a centered column at most 480px wide, a bottom tab bar (Home, Words, Settings), the system font, light and dark themes. Gender colors: der blue, die red, das green. Installable as a PWA.
- **Home:**
  - deck switcher
  - primary button "Train · N due" and secondary button "Learn new · N ready"
  - "Add words"
  - review count for today
  - a banner showing pending-generation progress
- **Add words** has two tabs:
  - **Add new words:** a stepper (5/10/20/custom, up to 50), then progress, then a "Learn them now" button.
  - **Import:** a textarea plus a file picker (.txt/.csv/.tsv), an input-language toggle, a live preview, then progress, then a summary with retry for failed words.
- **Learn new:**
  - Words come in groups of 5.
  - Each word first gets an intro card showing both sides: the word with its colored article, plural or verb forms, translation, the highlighted sentence and its translation, and a TTS button using `speechSynthesis`.
  - Intro buttons: "Got it" and "I already know this" (the latter rates the card Easy).
  - After the group comes a quick check: flip, then the 4 FSRS buttons, then cards requeue within the session until they graduate, then a summary.
- **Train:**
  - A direction toggle with DE→EN, EN→DE, and Mixed.
  - The front shows the prompt side. For DE→EN that is the German word with its article, plus the sentence with the word blanked out (optional). For EN→DE it is the English translation plus the English sentence.
  - Tapping flips the card to show the full card.
  - Four grade buttons, each labelled with its interval from the client-side `ts-fsrs` preview.
  - Keyboard: Space to flip, 1–4 to grade.
  - Reviews are optimistic, with a localStorage outbox that retries.
  - When nothing is due, show "All done, next card in Xh" and a "Practice anyway" button.
- **Words:** search, a status filter, and a card detail view where you can edit, suspend, regenerate, or delete.
- **Settings:** deck settings (name, daily new limit, level, skipTopN, language pair at creation), new deck, theme, TTS autoplay, and About with the attribution.

## 7. Structure
```
package.json wrangler.jsonc vite.config.ts tsconfig*.json vitest.config.ts .dev.vars.example
migrations/0001_init.sql 0002_wordlist_de.sql
data/wordlists/de.json   scripts/build-wordlist.ts wordlist-to-sql.ts
src/shared/  languages.ts normalize.ts parseImport.ts srs.ts schemas.ts types.ts display.ts
src/worker/  index.ts env.ts middleware/{auth,errors}.ts routes/*.ts services/*.ts db/*.ts ai/{generator,anthropic,fake,prompts,schema}.ts
src/client/  index.html main.tsx App.tsx styles.css lib/{api,queries,outbox,tts}.ts screens/*.tsx components/*.tsx
public/manifest.webmanifest icons/   test/{worker,shared}/*.test.ts
```

## 8. Milestones
- **M1: scaffold.**
  - Build: Vite + React + Tailwind + a Hono Worker through the Cloudflare Vite plugin, `GET /api/health`, one Vitest test, git init, and a `.gitignore` covering `.dev.vars`, `.wrangler`, and `node_modules`.
  - Done when: `npm run dev` shows the health response and `npm test` passes. Deploy waits until the user has a Cloudflare account.
- **M2: auth, users, and decks.**
  - Build: migration 0001, auth middleware with tests (401 when the token is missing or has a bad aud, 200 with a valid token signed by a local test key, 403 when the email is not allowed), `/me` that auto-creates a deck, deck CRUD, and the language registry.
- **M3: import without AI.**
  - Build: normalize, parseImport (unit-tested), `/import`, the Words screen, and the Import tab with preview.
  - Test: importing `der Hund\nHund\nKatze;cat\n# comment\n\ngehen` gives 3 cards and 1 duplicate.
  - Test: a 500-row import works with chunking.
- **M4: AI generation, cache, and rate limit.**
  - Fake-provider tests: a cache hit, an alias hit (ging→gehen), dedup, not_a_word→failed, and the rate-limit cutoff.
  - With a real key: 20 common words come back correct.
  - The same words imported by a second user cause 0 AI calls.
- **M5: SRS and Train.**
  - Build: `srs.ts`, idempotent `/reviews`, `/review`, and the Train screen with its direction toggle, interval labels, and keyboard shortcuts.
- **M6: Learn-new flow.**
  - Covers the daily limit, intro cards, the quick check, requeueing, TTS, and the summary.
- **M7: "Add X new words".**
  - Build: the word-list scripts and data, `/suggest`, the Add tab, skipTopN, and the AI fallback.
  - Done when: there are at least 4k lemmas, there are no duplicates or re-suggestions, and running out of words reports `exhausted`.
- **M8: polish and PWA.**
  - Covers stats, the outbox, card edit, suspend, regenerate, dark mode, the manifest and icons, toasts, and About.
  - Target: Lighthouse accessibility and best-practices scores of at least 90.
- **M9: second language pair check.**
  - An en→es deck works end-to-end, with no German-specific branches outside `languages.ts`.

## 9. Dev and deploy
- **Accounts:**
  - Cloudflare (free).
  - Zero Trust Free plan (pick a team name).
  - Anthropic Console: an API key, $5 of credit, and a monthly spend cap.
- **Local setup:**
  1. `npm install`
  2. `npx wrangler d1 create flashcards`, then put the id into `wrangler.jsonc`
  3. Copy `.dev.vars.example` to `.dev.vars` and set `DEV_AUTH_EMAIL` and `AI_PROVIDER=fake|anthropic` (and `ALLOWED_EMAILS` only if you test real Access tokens locally)
  4. `npm run db:migrate:local` (includes the curated dictionary; after editing it, `npm run seed:sql` regenerates `migrations/0003_seed_de.sql`)
  5. `npm run dev`
  6. `npm test`
- **Deploy:**
  1. `npm run db:migrate:remote`, always BEFORE `npm run deploy`: the new build expects the
     curated dictionary (`migrations/0003_seed_de.sql`) and every other migration to be applied.
     Apply a migration locally first (`npm run db:migrate:local`).
  2. Optional, not needed for the no-AI dictionary: `npx wrangler secret put ANTHROPIC_API_KEY`
  3. `npx wrangler secret put ALLOWED_EMAILS` (comma-separated). The repo is public, so the allowlist is never a `wrangler.jsonc` var. Until it is set, every login gets 403.
  4. `npm run deploy`
- **Secrets:** `ANTHROPIC_API_KEY`, `ALLOWED_EMAILS`.
- **Vars:** `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `AI_PROVIDER`, `AI_MODEL=claude-haiku-5-5`, `AI_USER_DAILY_LIMIT=200`, `AI_GLOBAL_DAILY_LIMIT=2000`. `DEV_AUTH_EMAIL` is never set in production.
- **Access setup:**
  1. Enable Cloudflare Access on the worker's workers.dev route.
  2. Add an Allow policy for the user emails.
  3. Turn on One-time PIN.
  4. Set the session to 1 month.
  5. Copy the AUD tag.
  6. Protect or disable preview URLs.
