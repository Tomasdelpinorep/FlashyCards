# Decisions and deviations from PLAN.md

## M1 (scaffold)

- **Worker tests run in plain Node, not `@cloudflare/vitest-pool-workers`.**
  Tests import the Hono app and call `app.request(...)` directly (`environment: 'node'`).
  This is the simplest setup that works reliably on Windows and with the current
  Vitest major (5.x). When tests need D1 (M2+), pass a mock/in-memory `env` as the third
  argument of `app.request(path, init, env)`, or revisit the workers pool if
  real-runtime fidelity becomes necessary.

- **Vite root is `src/client`.** PLAN.md section 7 places `index.html` in `src/client/`,
  so `vite.config.ts` sets `root: src/client`, `publicDir: public`, `build.outDir: dist`,
  and points the Cloudflare plugin at the root `wrangler.jsonc`. Build output:
  `dist/client` (static assets) and `dist/flashcards` (Worker + generated deploy config).

- **Worker types come from `wrangler types`** (`worker-configuration.d.ts`, committed),
  not `@cloudflare/workers-types`. Re-run `npm run cf-typegen` after changing
  `wrangler.jsonc`.

- **`assets.run_worker_first: ["/api/*"]`** in `wrangler.jsonc`, so API paths never hit the
  SPA fallback (unknown `/api/*` routes get a 404 from Hono rather than `index.html`).

- **TypeScript 7** (the current stable, native compiler) is used; `npm run typecheck`
  runs `tsc -b` over three projects: app (client), worker (+tests), node (configs).

## M2 (auth, users, decks)

- **D1 in tests: a small D1-compatible adapter over Node's built-in `node:sqlite`**
  (`test/helpers/d1.ts`), not `better-sqlite3` (native build on Windows) and not
  `@cloudflare/vitest-pool-workers` (M1 decision stands). Each test gets a fresh in-memory
  database with every `migrations/*.sql` applied in order and `PRAGMA foreign_keys = ON`
  (D1 enforces FKs). It implements the D1 subset the app uses: `prepare/bind/first/all/run/raw`,
  transactional `batch`, `exec`. Node prints an "SQLite is experimental" warning; harmless.
  Requires Node >= 22.13 (dev machine: 24.9).

- **Migration 0001 implements PLAN §3 as amended by "User decisions" and by
  `docs/DUPLICATES.md` §10.2** (the spec landed during M2; 0001 was updated in place because
  nothing had been committed or applied remotely). Card uniqueness is the two partial unique
  indexes `cards_input_uq` / `cards_lemma_uq` + the `cards_term` index; no duplicate logic yet
  (M3/M4). Additions not spelled out in the plan: `ON DELETE CASCADE` on child rows of
  users/decks/cards (so deck deletion works with D1's FK enforcement),
  `cards.duplicate_of ... ON DELETE SET NULL`, `cards.entry_id ... ON DELETE SET NULL`,
  `review_logs.direction` restricted to `'target-source' | 'source-target'`.

- **App factory.** `src/worker/app.ts` exports `createApp({ jwks })`; `src/worker/index.ts`
  exports `createApp()` as the Worker and `AppType`. Tests inject a local JWKS
  (`createLocalJWKSet`) and sign RS256 tokens with a generated key pair. Production uses
  `createRemoteJWKSet(${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs)`, cached at module scope.

- **Auth details.** `/api/health` stays public; everything else under `/api` is authenticated
  (unknown routes give 401 before auth, JSON 404 after). Only RS256 is accepted. Fail-closed:
  empty `ALLOWED_EMAILS` -> 403 for everyone; missing `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` -> 500.
  A valid token without an `email` claim (e.g. a service token) -> 403. Emails are stored
  lowercased. The dev bypass does **not** consult `ALLOWED_EMAILS` (it is local-only by design).
  Users are read first and inserted only if missing, so most requests cost no D1 write.

- **Default deck.** *(Superseded in M3, see below.)* Originally created on `GET /me` whenever
  the user had no decks, with `DELETE` of the last deck refused (409).

- **Deck language pair is immutable** after creation (`PATCH /decks/:id` accepts only
  `name` and partial `settings`; settings are merged). Other users' decks return 404.
  Validation failures return `400 { error: 'invalid_request', issues }`.

- **`Bindings` type is declared by hand** in `src/worker/env.ts` instead of using the
  generated global `Env`, because `wrangler types` types vars as their literal
  `wrangler.jsonc` defaults (e.g. `ACCESS_AUD: ""`) and omits `.dev.vars`-only values such
  as `DEV_AUTH_EMAIL`. Don't re-run `cf-typegen` with a `.dev.vars` present unless you want
  its keys in the committed `worker-configuration.d.ts`.

- **Client typecheck includes `worker-configuration.d.ts`** (`tsconfig.app.json` `types`),
  because `hc<AppType>` makes the client project type-check the worker sources, which use
  Workers globals such as `D1Database`. Only affects type-checking, not the bundle.

- **Fixed an M1 bug: the Vite plugin stored local state in `src/client/.wrangler`** (it
  resolves `.wrangler/state` against the Vite root), so `npm run dev` never saw the D1 that
  `npm run db:migrate:local` wrote to `./.wrangler`. `vite.config.ts` now sets
  `persistState: { path: <repo>/.wrangler/state }`.

- **Language registry** includes `es` (cheap; for M9). `sentenceLevel` accepts
  `'A1-A2' | 'B1-B2' | 'C1-C2'`. Stored `settings_json` is parsed leniently: invalid or
  missing fields fall back to defaults, unknown keys are dropped.

## M3 (import without AI) + zero-deck fix

- **Zero-deck fix (user request).** The default "German" en->de deck is now created only when
  the user row is created (first authenticated request of any kind, not only `/me`), in the
  same `db.batch` as the user insert: `INSERT INTO decks ... SELECT ... WHERE EXISTS (SELECT 1
  FROM users WHERE id = <this request's fresh id>)`. A request that loses the
  `ON CONFLICT(email) DO NOTHING` race has a user id that never existed, so it creates no deck.
  `/me` never creates decks; any deck can be deleted (the 409 is gone); a user may have 0 decks.
  `ensureDefaultDeck` and `countDecks` were removed. Client: "You don't have any decks yet" +
  "Create a deck" (name + language pickers from `/api/languages`).

- **`LanguageConfig` gained `glossStripPrefixes`** (en `to/a/an/the`, de `der/die/das/ein/eine`,
  es `el/la/los/las/un/una`) **and `importHeaderWords`** (column titles that mark a header row),
  so header detection has no language branches outside `languages.ts`.

- **`termKey` details.** Order as in PLAN §3. Strips one leading article of *that* language only
  if something remains ("die" stays "die"). Plural notation stripped: `, -e` / `, ¨-er` / `, -`
  (any dash/umlaut marker after a comma), `, pl. …`, `, die Hunde` (comma + article + word),
  `(pl. …)`, `(Pl.: …)`, `(plural …)`, `(-e)`. Other commas/parentheses are kept
  ("Bank (Geld)" -> "bank (geld)"). It does **not** strip English "to": `termKey('en','to begin')`
  is `'to begin'` (spec: articles only); the gloss level (`glossKey`) equates "to begin" and
  "begin", and M4 resolution will mark such source-side pairs as duplicates.

- **`termKey` for `inputLang='auto'`** strips the articles of both languages
  (`termKey(target, termKey(source, s))`), since the side is unknown. Alias lookup in auto mode
  uses each side's own key (`termKey(target_lang)` for `target`, `termKey(source_lang)` for `source`).

- **`parseImport` details.** Delimiter chosen per line with priority tab > `;` > `|` (then `,`
  for `.csv`). Double-quoted fields with `""` escapes are honoured (CSV exports). The header row
  is the first data line when all its columns are header words and it has >= 2 columns (a
  single-column header is only skipped in `.csv`/`.tsv` files, so a pasted list starting with
  "Wort" keeps it). A hint over 100 characters also makes the row invalid. Invalid reasons:
  `empty_term`, `too_long`. The 500 limit counts data lines (valid + invalid); more is a
  `400 { error: 'too_many_rows' }` (the request body is capped at 200k characters).

- **Import response counts are per import:** `added = ready + pending` = cards inserted by this
  request (PLAN §4's `pending` read as "added as pending"). "N already in your deck" in the
  summary counts all duplicate reports, including `in_file` ones, as in §10.8's example list.

- **Import implementation notes (§10.3).**
  - Candidate ordering is `created_at, rowid`, so rows inserted by one import keep file order
    (needed for "re-import Bank -> points to Bank;bench").
  - A card's glosses for duplicate checks = `card_glosses` + its `hint_key` + its extra
    translations + (for source-side input) `glossKey(input_term)`. The last three cover pending
    cards, which have no `card_glosses` yet, so re-importing "dog" (source) never adds "dog" as an
    extra translation of the "dog" card.
  - `mergeTranslation` is skipped when the side is unknown (`auto` without an alias hit).
  - Two rows of one file that resolve through aliases to the same entry: the second is reported
    `in_file` (the planned card is a duplicate candidate too) instead of losing to the index.
  - The SQL guard also caps extras: `... AND json_array_length(extra_translations_json) < 10`.
  - Multi-row inserts use numbered parameters (`?1` deck id, `?2` now, then 12 values per row:
    7 rows = 86 params). Glosses of `ready` inserts are written by ONE statement over a JSON
    array (`json_each` joined to `cards`), so a row that lost the `INSERT OR IGNORE` race gets no
    glosses and no FK error. Merges use `INSERT ... SELECT ... FROM cards WHERE id = ?` for the
    same reason.
  - **Risk to check on deploy:** a 500-row import is one `db.batch` of ~72 insert statements
    (plus one per merged translation). If D1 counts batch statements against the Workers Free
    "queries per invocation" limit, very large imports may need the inserts folded into a single
    `INSERT OR IGNORE ... SELECT FROM json_each(?) RETURNING id` (unbounded rows, one statement).
    Kept the spec's <= 7-rows form for now. *(Resolved in M4: see "D1 query budget" below.)*

- **Card list.** `GET /decks/:id/cards?status&q&cursor&limit` (limit 1-100, default 50), newest
  first, keyset cursor `"<created_at>_<id>"`. Without `status`, duplicate and deleted cards are
  excluded; deleted cards are never listable. `q` matches (case-insensitive, `LIKE` with escaped
  wildcards) the input term, hint, lemma, translation and extras, plus the query's own term key
  against `term_key`/`lemma_key` (so "der Hund" finds `hund`). `DELETE /cards/:id` is an
  idempotent soft delete that also drops the card's `card_glosses`; other users' cards -> 404.

- **Stats are basic for M3:** `total, ready, pending, failed, suspended, new, learning, review,
  dueNow, duplicates` (duplicates/deleted never in `total`). PLAN's `dueToday`, `reviewedToday`
  and `newToday` need a user day boundary and review logs; they arrive with M5/M6.

- **Client.** `react-router` 8 (`BrowserRouter`) and `@tanstack/react-query` 5 added. Routes:
  `/` Home, `/words`, `/add` (Import tab only; "Add new words" is M7), `/settings` (stub with
  account, deck list + delete, new deck). The current deck is remembered in `localStorage`
  (convenience only; falls back to the first deck). Summary copy lives in
  `src/client/lib/importCopy.ts` (unit-tested); summary lines link to
  `/words?q=<display>&card=<id>`, which highlights the card.

## M4 (AI generation, cache, rate limit)

- **D1 query budget (Part 0).** D1 on Workers Free allows ~50 queries per invocation and every
  statement of a `db.batch` counts. Rule from M4 on: **a request issues a fixed number of
  statements regardless of how many rows it handles**. Lists travel as ONE JSON parameter
  expanded with `json_each()`, never as chunked `IN (...)` lists or one statement per row.
  - Import: alias lookup = 1 query (aliases joined to entries); candidates = 1 query (glosses
    aggregated with `json_group_array`); one batch with the merge UPDATE (a set-based,
    idempotent, 10-capped rewrite of `extra_translations_json`), ONE
    `INSERT OR IGNORE INTO cards ... SELECT ... FROM json_each(?) ORDER BY key RETURNING id` for
    all rows, and ONE gloss insert. Measured: **5 statements for a 500-row import** (was ~72),
    7 with alias hits and merges, +1 when a parallel import wins a race.
  - Generate: measured **15 statements** for a 10-card call with cache hits, misses, duplicates
    and not_a_word; 12 on the parallel-race path (phase B).
  - `test/helpers/d1.ts` counts executed statements (each batch member counts).
    `ctx.countQueries(fn)` lets tests assert import <= 25 and generate <= 30, auth and deck
    lookup included.
  - This supersedes §10.3's "<= 7 rows per INSERT" and "chunks of <= 90 keys". `selectIn`/`chunk`
    remain in `db/util.ts` but no request path uses them.
  - The `cards_lemma_uq` backstop is not caught and retried one card at a time (§10.4). The guard
    can only fail across requests, and `batchSeen` excludes within-batch conflicts first, so the
    index cannot fire from our own statements. If it ever fires the request returns 500, the
    leases expire after 90 s, and the next call retries.

- **Generate is set-based.** §10.4's per-card steps are folded into statements:
  - The guarded `UPDATE ... NOT EXISTS` is ONE `UPDATE cards ... FROM json_each(?) ... RETURNING
    id` for every card to ready.
  - markDuplicate, failures/attempts and lease release are one statement each.
  - Cards the guard rejected (a parallel request readied the same lemma first) are re-read
    (1 query) and marked duplicate in a second small batch. Cards already marked duplicate *of
    such a loser* in the same call are re-pointed to the winner.
  - `entries` uses `INSERT ... SELECT ... ON CONFLICT DO NOTHING`; aliases and the winner read
    go in the same 3-statement batch.

- **Generator abstraction.** The `ai/` folder holds:
  - `generator.ts`: the interface plus `GeneratorError{retryable}`
  - `create.ts`: `createGenerator` picks Anthropic for `AI_PROVIDER=anthropic` with a key,
    otherwise fake, with a `console.warn` when anthropic is requested without a key
  - `anthropic.ts`, `fake.ts`, `prompts.ts`, `schema.ts`

  `createApp({ generator })` injects one for tests (routes call `c.get('generator')()`).
  - **Risk:** the requested "fall back to fake when there is no key" also applies in production.
    Fake entries (model `fake`) would then land in the global cache and be reused. Set the
    secret before deploying with `AI_PROVIDER=anthropic`. Fake rows can be found with
    `entries.model = 'fake'`.

- **Anthropic request** (per the `claude-api` skill): `client.messages.parse` with
  `output_config.format = zodOutputFormat(BatchSchema)`.
  - Model `AI_MODEL` (default `claude-haiku-5-5`), `max_tokens: 8000`.
  - `thinking: {type:'disabled'}` (PLAN §1) plus `output_config.effort: 'low'`. On Haiku 5.5,
    `disabled` is only accepted at effort <= high, and the default effort there is `medium`.
  - No `temperature`/`top_p`/`top_k` (Haiku 5.5 rejects non-default sampling).
  - SDK `maxRetries: 1`, timeout 60 s.
  - Error mapping:
    - Retryable: 429, 408/409, >= 500 (incl. 529), connection errors, `max_tokens` truncation,
      schema misses.
    - Not retryable: refusals and other 4xx (400/401/403).
  - The skill recommends adaptive thinking with low effort over disabling it. I kept PLAN's
    "thinking disabled" because the output is short and structured. Revisit if the real-key
    check shows weak sentences.

- **Every failed call counts an attempt, retryable or not.** PLAN §5 only names 429/5xx, but a
  non-retryable error (bad key, 400) would otherwise loop forever.
  - The card stays pending and becomes `failed` after 3 attempts; `gen_error` keeps the last
    message.
  - An item missing from the response, or one without a lemma or translation, also counts an
    attempt.
  - `not_a_word` fails at once (`gen_error = 'not_a_word'`).
  - The budget consumed by a failed call is not refunded.

- **Schema details** beyond PLAN §5:
  - `input_side` (§10.2).
  - `verb.perfect_3sg` ("ist gegangen"), so the client shows "geht · ging · ist gegangen" with no
    language logic.
  - Gender is a language-neutral enum: masculine/feminine/neuter.
  - `LanguageConfig.genderArticles` (de der/die/das, es el/la) drives article/gender agreement.
    A known gender sets the article; an article alone sets the gender.
  - The German hints in `languages.ts` now name the schema fields and ask for both parts of a
    separable verb to be wrapped, so `[[ ]]` may appear more than once. `hasValidMarkers`
    accepts one or more well-formed pairs; a sentence with malformed markers is stored with them
    stripped.

- **Post-validation:**
  - Outputs are matched by `input` (exact, then case-insensitive), then by position when the
    counts match.
  - A leading article is stripped from the lemma.
  - At most 3 alternative translations, deduped against the main translation.
  - For `auto` input the side comes from the model; otherwise the user's declared `input_lang`
    wins.

- **Rate limit.**
  - `checkBudget` (1 query) computes how many misses fit under both the per-user and the global
    limit.
  - `consumeBudget` is ONE guarded `INSERT ... SELECT ... WHERE NOT EXISTS(over limit) ON
    CONFLICT DO UPDATE` that writes both scope rows or neither.
  - Partial batches are allowed: with 2 words left, 2 of 10 misses are generated and
    `rateLimited: true`. The remaining cards have their lease released, with no attempt counted.
  - Cache hits are still resolved while limited.
  - `limitResetsAt` is ms since epoch (next UTC midnight).
  - Identical misses in one call are sent (and counted) once.

- **Spec test "dog after Hund -> Hund's extras = ['dog']"** only holds when "dog" is not already
  one of Hund's glosses, because mergeTranslation skips known glosses. The fake lexicon gives Hund
  "dog" + "hound", so that test overrides Hund's translation to "hound". A second test checks
  that the normal case adds nothing (`addedTranslation: null`).

- **"Duplicates excluded from learn/review"** is tested for stats, the default card list and
  retry-failed. `/learn` and `/review` do not exist yet (M5/M6); they must filter
  `status = 'ready'`, which excludes duplicates.

- **Card DTO.**
  - `content`: the entry merged with `override_json` by `shared/display.ts mergeContent`; null
    while pending or failed.
  - `genError`.
  - `alsoInDeck`: GET `/cards/:id` only, <= 3, one self-join on `card_glosses`.
  - `display` and `translation` now come from the merged content.
  - `GET /api/cards/:id` was added (PLAN §4) for the detail view.

- **Client.**
  - `GenerationProvider` (in `App`) runs the `/generate` loop for the current deck:
    - starts after an import that left pending cards, and resumes whenever stats show pending
      cards;
    - stops on `remaining = 0`, on `rateLimited` (no auto-resume until `limitResetsAt`), or on an
      error ("Try again");
    - backs off 3 s when a call makes no progress (another tab holds the lease).
  - `GenerationBanner` (on Home and under the import summary) shows "Preparing N words… x/N",
    the daily-limit message, and "N couldn't be prepared · Retry failed".
  - Duplicates found by generate are listed under the import summary with the §10.8 copy, and
    counted in Home's existing "already in your deck · View" banner.
  - The words list shows "translation · also: …" and each row links to `/words/:id`.
  - `/words/:id` is a simple detail view: coloured article, forms, translation + also, other
    meanings, highlighted sentence + translation, duplicate/also-in-deck links, delete, and retry
    for failed cards.

- **Cache is level-agnostic.** Entries are keyed by (lemma, sense), not by the deck's sentence
  level, as in the PLAN schema. A B1 deck reuses an A1-A2 sentence that is already cached.
  `prompt_version` is stored so stale rows can be refreshed later.

