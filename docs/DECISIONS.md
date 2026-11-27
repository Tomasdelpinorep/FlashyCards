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
  empty or missing `ALLOWED_EMAILS` -> 403 for everyone (a secret since M5, see below); missing `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` -> 500.
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
  - *(Superseded in M5 Part 0: a missing key now fails closed.)* The M4 fallback to fake when
    there was no key also applied in production, which could have put fake entries in the
    global cache. Any such rows can be found with `entries.model = 'fake'`.

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

## M5 (SRS core and Training mode)

- **Part 0: the generator fails closed** (orchestrator request). `createGenerator(env, requestUrl)`
  in `ai/create.ts` returns `null` when AI isn't configured:
  - `AI_PROVIDER=fake` -> fake on any host.
  - `AI_PROVIDER=anthropic` -> Anthropic with a key; **no key -> null, even on localhost**.
  - `AI_PROVIDER` unset -> Anthropic if a key is set; otherwise fake **only** on
    `localhost`/`127.0.0.1` (the dev-bypass rule), else null.
  - Any other value -> null.

  On `null`, `POST /generate` answers `503 {error:'ai_not_configured', message:"AI isn't configured
  on the server"}` **before claiming anything**: cards stay pending with no lease and no attempt,
  and nothing is written to `entries`, `entry_aliases` or `ai_usage`. The client's generation loop
  stops (no auto-retry) and the banner says "AI isn't configured on the server. N words will wait
  until it is." with "Try again". Cache hits are not resolved while AI is off (simplest; the
  next working call resolves them). Tests: `test/worker/aiConfig.test.ts` plus the
  `createGenerator` unit tests. `setup(env, { generator: 'env' })` uses the real factory.

- **`ALLOWED_EMAILS` is a secret, not a var** (orchestrator request: the repo will be public). It
  was removed from `wrangler.jsonc` `vars` (a comment explains it), and from
  `worker-configuration.d.ts` by hand, not by `cf-typegen`, so no `.dev.vars` keys leak into it.
  `.dev.vars.example` lists it. `Bindings.ALLOWED_EMAILS` is now optional, and missing or empty
  means 403 for every Access login (tested). Production: `npx wrangler secret put ALLOWED_EMAILS`
  (PLAN §9). Two test fixtures on `x.com` were moved to `example.com`. No real addresses are in
  tracked files.

- **ts-fsrs 6.0.0** (the current stable major) **with `DefaultScheduler({ version: 'FSRS-6' })`.**
  - v6 replaced the v4/v5 `fsrs()` API, which is still exported but deprecated, with an async
    `DefaultScheduler` that defaults to FSRS-7. FSRS-7's memory state needs an extra
    `stabilityFast` that migration 0001 does not store. FSRS-6 keeps exactly our columns, so no
    migration is needed. Moving to FSRS-7 later means one column plus `toFsrsCard`/`fromFsrsCard`.
  - The v6 card has camelCase fields (`dueAt`, `lastReviewAt`, `scheduledDays`, `learningStep`,
    `scheduleStatus`, `cardId`) and no `elapsed_days`. `scheduleStatus` is derived from `state`
    (0 new, 1/3 learning, 2 review). `cards.elapsed_days` is written with the whole days since the
    previous review, for reference only.
  - The scheduler is created asynchronously (the model loads lazily, so Vite emits small
    per-model chunks). `loadSrs(overrides)` memoises one per config and resolves to a sync `Srs`
    with `review`/`preview`. Tests inject `{ enableFuzz: false }` through `createApp({ srs })` /
    `setup(env, { srs })`.
  - Config as PLAN: retention 0.9, max interval 365 d, fuzz on, steps 1m/10m, relearning 10m.
    v6 with FSRS-6 also implies `graduatingInterval: 1` and `allowModelOverride: false`.

- **Fuzz is deterministic per card**: ts-fsrs v6 seeds it from the card id and review count. The
  client preview (`previewIntervals`) therefore gives exactly what the server will compute for
  the same rating at the same time. The labels are exact, apart from client/server clock skew and
  the server's reviewedAt clamp. Tests still allow for fuzz (a band around the unfuzzed interval)
  or turn it off.

- **`POST /reviews` race safety without a log nonce.** Both statements of the batch
  compare-and-swap on the card's pre-review `(reps, last_review)`, which every review changes.
  The log is `INSERT OR IGNORE ... SELECT ... WHERE` the card is still at that state, and the card
  `UPDATE ... WHERE` it is still at that state AND our log row exists, `RETURNING` the new state.
  - A repeated id (sequential or concurrent) applies once. The loser re-reads, finds its own log
    row, and returns the current card with `applied: false`.
  - A *different* id racing on the same card makes the CAS fail with no log row. The server
    recomputes from the fresh state, at most 3 rounds, then `503 review_conflict`, which the
    outbox retries.
  - `reviewedAt` is clamped to [now−7d, now], and also never earlier than the card's
    `last_review`.
  - The response is `{ card: { id, status, srs }, applied }` (the schedule only, not the full
    DTO).
  - Errors:
    - 404: not owned, deleted or unknown card.
    - 409 `card_not_ready`: pending, failed, suspended or duplicate.
    - 409 `review_id_conflict`: an id reused for another card or user.
    - 400: an invalid body (UUID, rating 1–4, direction `target-source|source-target`, strict).
  - Measured: **4 statements** (auth 1 + read 1 + batch 2); a repeat costs 2. The tests assert
    ≤ 6 and ≤ 4.
  - The concurrency test uses a gated D1 proxy so both requests read before either batch runs.
    Removing the reps CAS makes it fail, so the test is not vacuous.

- **`GET /decks/:id/review`**: `status = 'ready' AND state IN (1,2,3) AND due <= now + 20 min`,
  ordered by `due, id`, with `limit` 1–100 (default 50).
  - `ahead=1` drops the due bound (it binds `MAX_SAFE_INTEGER`, so the statement shape is the
    same).
  - `alsoInDeck` for the whole page is ONE self-join over `card_glosses` driven by `json_each(ids)`,
    capped at 3 per card in JS. `GET /cards/:id` uses the same helper.
  - `nextDueAt` is the first card's due, or `MIN(due)` of studied ready cards when the queue is
    empty (one extra statement only then).
  - Measured: 4–5 statements; the test asserts ≤ 5.
  - The Card DTO gained `srs` (all FSRS columns) for previews and the requeue.

- **Stats.**
  - **`dueNow` now includes the 20-minute learn-ahead**, so "Train · N due" matches what Train shows.
    Before M5 it was `due <= now`.
  - `dueToday` = studied ready cards with `due` before the end of the local day.
  - `reviewedToday` = this user's review logs on this deck's cards since the start of the local
    day.
  - `newToday` = those logs with `state_before = 0`.
  - The local day comes from `?tzOffset=` = the client's `Date#getTimezoneOffset()` (minutes,
    −840..840; UTC+2 is −120), default UTC.
  - Still ONE statement (two scalar subqueries).

- **Train screen** (`/train`; Home's primary button is "Train · N due").
  - Direction toggle (`DE→EN`/`EN→DE`/Mixed, labels built from the deck's codes), saved with
    `PATCH /me` `studyDirection`. Mixed picks per card when it appears; switching mode re-picks
    the card on screen unless it is flipped.
  - Faces come from `shared/display.ts cardFaces()` (unit-tested):
    - DE→EN front: the coloured word plus the sentence with `[[…]]` → `____`, unless
      `hideSentenceOnFront`.
    - EN→DE front: the translation line plus `example_source` with its highlight, always.
    - Back: everything, with "Also in your deck" only when shown EN-first and non-empty.
  - Space or tap flips; 1–4 grade; Listen uses `speechSynthesis` in the deck's `ttsLang` (word,
    then sentence). `ttsAutoplay` speaks the word on flip.
  - The queue logic is in `lib/session.ts` (unit-tested). A graded card that comes due within the
    learn-ahead window (a learning or relearning step) is requeued with its locally computed
    schedule. It is shown once due, or earlier when nothing else is left (Anki-style
    learn-ahead).
  - Empty or end state: "All done · Next card in 3h" (soonest of the server's `nextDueAt` and this
    session's new due times), "N cards reviewed · X% correct" (Hard/Good/Easy count as correct),
    and "Practice anyway" (`ahead=1`, a new session).
  - `hideSentenceOnFront` and `ttsAutoplay` have no Settings toggles yet (M8). They are honoured
    when set through `PATCH /me`.

- **Outbox** (`lib/outbox.ts`): a pure core with injected storage and transport (unit-tested with
  a fake storage) plus a browser binding.
  - Entries are keyed by review UUID in insertion order under `flashcards.outbox.v1`.
  - It sends **one at a time, in order**, so two reviews of one card arrive in the order they were
    made.
  - Results:
    - 2xx: acknowledged and removed.
    - 401/403/408/429/5xx/network error: retried, and the drain stops there to keep order.
    - Any other 4xx: dropped (the card was deleted or suspended, or the id conflicts).
  - Drains on app load, on `online`, on window `focus`, after each review, and every 30 s while
    entries remain.
  - All storage access is in try/catch; without storage it keeps the queue in memory.
  - Concurrent flushes join one drain.

- **Not in M5:** the Learn-new flow (M6), so a ready New card only becomes reviewable through
  `POST /reviews` (the smoke test did exactly that). Train never shows New cards; a deck with only
  New cards shows "Nothing to review yet". No test-only or unauthenticated path was added.

## M6 (Learn-new flow)

- **`GET /decks/:id/learn?limit&tzOffset&extra`** (`db/cards.ts learnQueue`).
  - It returns `{ cards, remainingToday, readyNewTotal, newToday, dailyNewLimit }`. The cards are
    `status = 'ready' AND state = 0`, ordered `created_at, rowid` (oldest first, in import order),
    each with `alsoInDeck`. Pending, failed, suspended, duplicate and deleted cards never appear.
  - `newToday` = **distinct** cards of the deck with a review log by this user since the start of
    the local day (`tzOffset`, as in `/stats`) whose `state_before = 0`. `/stats` now uses the same
    SQL fragment (`NEW_TODAY_SQL`), switched from `COUNT(*)` to `COUNT(DISTINCT card_id)`. The two
    are equal in practice, since a card leaves New on its first review.
  - `remainingToday = max(0, dailyNewLimit − newToday)`; the page is `min(limit, remainingToday)`,
    with `limit` 1–100 and a default of 50.
  - **"Learn more anyway" = `?extra=N`** (1–50). It bypasses the daily cap: the page is
    `min(limit, extra)` New cards. `remainingToday` still reports the real value (0), and nothing
    is stored on the server: once those cards are reviewed they count toward `newToday` like any
    other. Home and the Learn empty state offer "Learn 5 more" (`/learn?extra=5`).
  - Measured: **5 statements** (auth, deck, counts, page, alsoInDeck); 3 when the cap leaves
    nothing to fetch. The test asserts ≤ 5 and ≤ 3.
- **Client session** (`lib/learnSession.ts`, pure, unit-tested). It wraps the M5 Train queue
  (`lib/session.ts`) rather than duplicating it.
  - Groups of 5. Each group gets its intros; "Got it" moves the card into the check queue, and
    "I already know this" posts **Easy, direction `target-source`**, through the outbox, after
    which the card leaves the session.
  - The quick check is the M5 session: `currentCard`/`gradeCard`, with learning steps requeued.
    The next group starts as soon as the check has nothing due *now* (every card of the group
    graded once and no requeued step due). Steps still waiting then interleave with the next
    group's check as they come due. After the last group they are shown early (learn-ahead) until
    they graduate. Each group therefore does not have to fully graduate before the next begins,
    which spaces the 10-minute step naturally.
  - "Words learned" = distinct cards graded in the quick check; "already knew" = Easy from the intro.
  - The direction is the saved `studyDirection` (Mixed picks per card). The Learn screen has **no
    direction toggle** (the spec says to use the saved one; Train still has the toggle).
  - Shortcuts (Space flips, 1–4 grade) apply in the quick check only. The intro has two plain
    buttons and no shortcut, so a key press can't mark a card as known by accident.
- **Reload / resume** (server is the source of truth).
  - The `/learn` query awaits `outbox.flush()` before fetching, so grades made before a reload
    already reached the server when online.
  - A small record in **sessionStorage** (`flashcards.learn.v1`: deck id, ids in flight, learned
    ids, already-knew count; dropped after 6 h or when the summary shows) lets the reloaded screen:
    - take cards it had left mid-step back from `GET /review` (only ids it touched, and only those
      still Learning/Relearning) and keep stepping them;
    - keep the summary counters.
  - New cards with a review still sitting in the outbox (offline) are skipped, so they are not
    introduced twice.
  - With `?extra=N`, a resumed session only tops up to N in total.
  - A card that was "got it" but not yet graded is still New on the server, so it simply gets its
    intro again.
  - Leaving mid-session and coming back within 6 h continues the same counters (same tab).
- **UI.**
  - Train's front/back/grade-button components moved to `components/StudyCard.tsx`, and Learn
    reuses them. The intro card is the full back via `shared/display.ts introFaces()`, which always
    includes "Also in your deck" when non-empty (§10.8, §10.9 M6) and is unit-tested.
  - `enqueueReview` (`lib/queries.ts`) is now the one place Train and Learn post reviews.
  - Home has a secondary "Learn new · N ready" (N = ready New cards), shown disabled at 0. When
    `newToday ≥ dailyNewLimit` it reads "Daily limit reached · Learn 5 more". The Learn empty state
    says "Daily limit reached" with "N new words today · M ready", or "No new words ready" (plus
    "N words are still being prepared" and "Add words").
  - The import summary's primary button is "Learn them now" → `/learn` when the import added cards.
    Words that are still generating show up once they're ready. "Add new words" (M7) will reuse it.
- Tests: `test/worker/learn.test.ts` covers the daily cap across a local-midnight boundary, the
  exclusions, the order, `extra`, limit 0, 5×Good → Learning → Review, Easy on New → days out,
  `alsoInDeck`, 404 and the statement budget. `test/client/learnSession.test.ts` covers
  intro→check→requeue, interleaving, all-known groups and resume. `introFaces` is in
  `test/shared/cardFaces.test.ts`.

## M7 ("Add X new words")

- **The German word list was lemmatized by hand, not by `scripts/build-wordlist.ts`** (no API key
  yet; orchestrator request). Source: hermitdave/FrequencyWords `content/2018/de/de_50k.txt`
  (OpenSubtitles 2018; repo code is MIT, the lists are CC-BY-SA-4.0). The top **10,300** tokens
  (PLAN said ~8k; 8k gave ~4,200 lemmas, so it went further to reach 5k) were decided one by one,
  in rank order, exactly as the script would ask Haiku to: keep/drop, dictionary lemma, POS
  (`ai/schema.ts` enum), gender for nouns. First rank wins; ranks renumbered 1..N.
  Result: **5,057 lemmas** in `data/wordlists/de.json` (2,725 nouns, 1,141 verbs, 675
  adjectives, 359 adverbs, 51 prepositions, 49 pronouns, 26 conjunctions, 26 numerals, 3
  interjections, 2 articles). The script exists for a future run or a new language and was not
  run. `scripts/wordlist-to-sql.ts` generates `migrations/0002_wordlist_de.sql` (100-row literal
  INSERTs, 52 statements + a DELETE) and refuses non-unique keys, gaps in ranks or invalid POS; a
  test checks the committed SQL matches the JSON.
  - Drop rules (PLAN section 5): people and city names, brands, abbreviations, single letters,
    English words (okay, sorry, cool, sir...), fillers and interjections (oh, äh, hm, hey, na,
    tja...), profanity and slurs, subtitle stage directions (stöhnt, seufzt, räuspert...) and
    bare separable prefixes (dar, überein). Kept on purpose: function words; the greetings
    `hallo`, `danke`, `tschüss` (as interjections); country and continent names (Deutschland,
    Amerika, Europa...: learner vocabulary, unlike city names); established loanwords (Job, Team,
    Party, Handy, Café).
  - Lemmas follow the dictionary: inflected forms map to the infinitive / nominative singular /
    base form ("ging" -> gehen, "besser" -> gut, "mir" -> ich, "den" -> der, "zum" -> zu,
    "Hause" -> Haus); plural-only nouns stay plural (Leute, Eltern). `der` stands for
    der/die/das/den/dem/des and `ein` for its forms.
  - **One lemma per lemma_key.** `lemma_key = termKey(lemma)` is lowercase, so homographs share a
    key and the more frequent reading wins: `sein` (verb; the possessive is lost), `Leben`
    (noun; the verb leben is lost), `essen` (verb), `weg` (adverb), `morgen` (adverb). This
    matches the app's card identity rule (cards are keyed the same way).
  - `gender` is in the JSON (2,706 nouns) for information only; the `wordlist` table has no
    gender column (the AI generates grammar per card).
- **Tests do not load the full list.** `createTestD1()` skips `migrations/*_wordlist_*.sql`
  (~13 ms per test DB, and fixtures need a known, small list); `setup(env, { wordlists: true })`
  applies it. Suggest tests seed a 25-word list; one test runs against the real migration, and
  `test/shared/wordlist.test.ts` checks the data (>= 4,000 items, unique keys, valid POS,
  contiguous ranks, capitalisation, a denylist of names/fillers/inflected forms, SQL in sync).
- **The POS is NOT the hint.** Storing it in `input_hint` would make `hint_key` non-empty and
  turn every suggested word into a sense-specific card (section 10.1). Suggested cards are plain
  words (`input_hint` NULL, `hint_key` ''). `/generate` reads the POS at claim time: the claim's
  `RETURNING` has a subquery on `wordlist` (same `term_key`, `origin = 'suggested'`, no extra
  statement) and passes it as `GenerationInput.pos`, which the prompt sends as `expected_pos`
  ("choose the reading with that part of speech"). `PROMPT_VERSION` is now 2. A cached entry
  still wins over the POS (the cache is keyed by lemma and sense only). AI-fallback suggestions
  carry no POS to `/generate` (no word list to read it from).
- **`/suggest` reuses the import path.** `importCards` was split: `insertRows(db, deck, rows,
  inFile, origin)` is steps 2-5 of section 10.3, and `/suggest` calls it with
  `origin='suggested'`, `input_lang='target'`, no hint (so alias hits are `ready` at once and
  reports have no `line`). The word-list query is section 10.7 verbatim: `GROUP BY lemma_key`,
  `MIN(rank)`, `rank > skipTopN`, excluding the deck's `lemma_key`s in any status and the
  `term_key`s of non-source cards, `LIMIT count + 1`.
  - `exhausted` = nothing left in the list after this request (so asking for exactly the
    remaining number says `exhausted: true`). The response also has `ready`
    (`added = ready + pending`), like `/import`. No top-up when duplicates appear later.
  - Measured: **6 statements** on the word-list path, **9** on the AI path (tests assert <= 8 and
    <= 11).
  - The word-list path needs no AI: a German deck can add words with AI off; `/generate` then
    fails closed as before.
- **AI fallback** (`hasWordlist: false`, e.g. Spanish): `SentenceGenerator.suggestWords` (fake +
  Anthropic: same model, structured output, thinking disabled at effort low, `max_tokens` 4000).
  It excludes up to 500 deck keys (lemma_key or non-source term_key, most recent first), asks for
  `ceil(count x 1.2)`, strips leading articles, dedupes by key and applies the same deck filter
  in SQL. `skipTopN` does not apply there. Errors: 503 `ai_not_configured` (before anything is
  read or written), 429 `rate_limited` + `limitResetsAt`, 503 `ai_unavailable` when the call fails.
  - **Budget: one suggestion call costs 1 word + 1 call** in `ai_usage` (both scopes, the same
    guarded upsert). Its output is a short list, much cheaper than a generated card; the words it
    suggests are counted again as cache misses when `/generate` prepares them. Not refunded if the
    call fails.
- **Attribution** lives in `LanguageConfig.wordlist` (`{name, url, license, licenseUrl,
  attribution}`, served by `GET /languages`) and in the JSON header, for M8's About screen.
  `de.hasWordlist` is now `true`.
- **Client.** Add words has two tabs, "Add new words" (default) and Import. The stepper is
  5/10/20/Custom (1-50), then "Add N words", then the existing generation banner and the section
  10.8 summary (`summaryText` now takes any `{added, duplicates, invalid?}`), "Learn them now" ->
  `/learn`. An exhausted list says "That was the end of the German word list", or "No new words
  left" when nothing was added. Settings gained a current-deck section with "Skip the N most
  common words" (`PATCH /decks/:id`, 0-50,000); M8 adds the other deck settings.
- **Tooling.** `tsx` was added as a dev dependency to run the scripts (`npm run wordlist:sql`,
  `npm run wordlist:build`); `scripts/` is type-checked with the node project.

## M8-QA (browser e2e, partial: scope cut by the user)

- **Setup.** `@playwright/test` 1.65 (Chromium only) + `@axe-core/playwright` (installed, not used
  yet). `npm run test:e2e` / `test:e2e:update`. Specs in `e2e/*.spec.ts` (vitest only includes
  `test/**`). Playwright's `webServer` runs `e2e/server.mjs`, which wipes `.wrangler/e2e-state`,
  applies the migrations to it with `wrangler d1 migrations apply --local --persist-to`, then starts
  Vite with `E2E=1` on 127.0.0.1:5180. This happens in the launcher, not a globalSetup, because
  Playwright starts the webServer *before* globalSetup. `globalSetup` checks the genuine first login
  (one "German" en->de deck).
- **Env isolation.** With `E2E=1`, `vite.config.ts` points the Cloudflare plugin at
  `e2e/wrangler.e2e.jsonc` (vars: `AI_PROVIDER=fake`, `DEV_AUTH_EMAIL=e2e@example.com`, high AI limits),
  sets the e2e persist dir, `hmr: false` and `inspectorPort: false`. wrangler reads `.dev.vars` from
  the config's folder, and `e2e/` has none, so the user's `.dev.vars` is never read. That config
  mirrors `wrangler.jsonc` by hand.
- **One user, serial.** All tests share the dev-bypass user, so `workers: 1`. An auto fixture resets
  decks and settings through the public API before each test (no backdoor). The AI cache is
  global and lives for the whole run, so the post-AI duplicate test only runs in the `mobile`
  project. Fake lexicon gained `source:pooch -> Hund` (for "added as a translation").
- **Projects:** mobile (Pixel 7) only, per the scope cut. The desktop project was removed.

### QA status / TODO
- **Covered (4 specs, passing):** first run and empty states; import of the pasted acceptance list
  (preview counts, in-file dupes, invalid rows, exact §10.8 summary, words list, card detail);
  .tsv upload with the progress banner; English input resolved post-AI (dog/pooch -> Hund,
  "added as a translation", Home duplicates banner, Words duplicate filter).
- **Bugs fixed:**
  1. The banner was missing until the first `/generate` returned (`bannerProgress`).
  2. A stale stats response restarted the generation loop and wiped its duplicates list
     (`shouldResume` and `startState`).
  3. "Learn them now" showed when every added word turned out to be a duplicate.
  4. Duplicate rows in Words showed the resolved lemma, not the input (`wordRowText`).
  5. The active filter chip was cut off at phone width (chips now wrap).
  6. Deep links and reloads on `/words/:id` broke in dev (`index.html` used a relative
     `./main.tsx`).

  Regression tests are in `test/client/generationState.test.ts` and `wordRow.test.ts`, plus the e2e
  import spec.
- **Not written (TODO):**
  - Add new words, Learn, Train (directions, keys, empty state), and the offline outbox spec.
  - Decks, Words search/filter/delete, and the rate-limit/AI-off banners (unit-tested only).
  - axe smoke tests.
  - A second consecutive e2e run.
  - A visual pass with the 44 px tap-target fixes.
- **Open visual issues spotted:**
  - Tap targets under 44 px: `btnSmall` h-9, chips h-8, segmented controls, the "Done" text links.
  - Home on an empty deck is a wall of zeros, with no "add words to start" guidance.

## M8+M9 (lean): edit/suspend, About, Settings toggles, PWA, QA fixes, en→es check

- **No service worker.** The app ships a manifest and icons only. A service worker could pin a stale
  bundle after a deploy, or cache Cloudflare Access's login redirect as if it were the app. Offline
  grading already works without one: reviews wait in the localStorage outbox (`lib/outbox.ts`, e2e
  `offline.spec.ts`), and the page itself needs the network to load.
- **Manifest behind Access:** `<link rel="manifest" crossorigin="use-credentials">`. Without it the
  browser fetches the manifest without cookies and gets the Access login page. The icon PNGs are
  rendered once from `public/icon.svg` by `scripts/gen-icons.ts` (with the Playwright Chromium) and
  committed. `vite build` copies `public/` into `dist/client`.
- **Card edit (`PATCH /cards/:id`, `services/editCard.ts`):**
  - Edits are merged into `cards.override_json`. An empty or null field deletes its key, so the
    card falls back to the shared entry. The entry, the lemma and `lemma_key` never change.
  - When the translation or the extras change, the card's `card_glosses` are rewritten. The rewrite
    is one `db.batch`: UPDATE, `DELETE FROM card_glosses`, then `glossInsertStatement`.
  - The key set comes from `resolvedCardGlosses()` in `resolve.ts`, now shared with `/generate`
    (its `cardGlosses` calls it). It is the entry glosses of the merged content, plus the extras,
    plus the input term for source-side input.
  - A note-only or status-only edit leaves the glosses alone.
  - 409 `card_not_ready` unless the card is ready or suspended. Unsuspending keeps the FSRS state.
- **Deviations from the plan:**
  - `updateCard` lives in `services/editCard.ts`, not `db/cards.ts`, to avoid an import cycle:
    `resolve.ts` already imports `db/cards.ts`.
  - The About page says Apache-2.0, not MIT, because `LICENSE` is Apache 2.0.
  - es keeps its `genderColors` (el blue, la red). The test checks that colouring follows the es
    config and that German articles never colour in es.
  - The client sends only the fields that changed, so untouched fields keep following the
    generated content.
- **AI-off copy:** without a key, `/generate` returns 503 before claiming any card, so the cards stay
  `pending`. The client loop stops for the session and resumes by itself the next time the app
  loads with pending cards (`shouldResume`). The banner therefore promises "filled in automatically
  once it's available (next time you open the app)". Failed cards need a manual Retry, and their
  copy says so ("try Retry later").
- **en→es check:**
  - Language details that had leaked into code moved into `LanguageConfig`:
    `DEFAULT_SOURCE`/`DEFAULT_TARGET`, `importExample` (the import placeholder), and
    `glossStyleHint` (the 'verbs as "to ..."' prompt hint, now only for English sources; the
    en→de prompt is unchanged).
  - `DEFAULT_DECK` takes its name from the config.
  - The fake generator has an es lexicon and per-language generic sentences.
- **QA fixes:**
  - Tap targets are now at least 44 px.
  - Home shows guidance on an empty deck, and a note when no word is ready yet.
  - Long invalid import terms wrap instead of widening the page.
  - Inactive tab labels and the deck language label now pass axe colour contrast.

## Learn/Train redesign: typed answers, two-step intro, verb tables
- **Answer check** (`src/shared/answerCheck.ts`, pure and unit-tested):
  - Train and the Learn quick check take a typed (or spoken) answer, auto-graded with an override.
  - Both sides are normalized the same way: NFC, lowercase, collapsed spaces, trailing `.!?` dropped,
    and the language's `answerFolds` (de: ae/oe/ue/ss = ä/ö/ü/ß; es: accents and ñ). English ignores
    `to`/`a`/`the` (`answerStripPrefixes`).
  - Accepted answers: the main answer, alt translations and the card's extra translations, each split
    on `,`/`;`, with `(...)` notes dropped.
  - German and Spanish nouns need the article (`requireArticleForNouns`). "Hund" is
    `missing-article` and "die Hund" is `wrong-article`, both graded Again. The article is checked
    before the typo distance, so a wrong article is never a "typo".
  - Live check while typing: only an exact match counts. It flips at once (no Enter), graded
    from the answer time (see "Grading from answer time"). The card then waits on its back
    (Enter / Next moves on, a grade overrides): the 1.2 s auto-advance was removed at the user's
    request.
  - Final check, on Enter: one typo (Damerau distance 1) on a term of 5+ letters (counted without
    the article) is "Almost — check the spelling", graded **Hard**, with "I was right" (Good) as an
    override. Anything else is Again.
  - A 1.5 s pause, leaving the box or the end of speech only shows a hint when the answer is not
    right yet. Flipping on a wrong answer needs Enter or "Show answer".
  - The review is sent when leaving the card, not on the flip, so an override never sends twice.
- **Mic:** spoken answers use the browser's Web Speech API (`SpeechRecognition`), in the
  `ttsLang` language, with 3 alternatives checked. In Chrome the audio goes to Google's speech
  service. It is free and needs no key. The mic button is hidden when the browser has no recognizer,
  and turned off for the session once the microphone is blocked. The e2e suite stubs it out.
- **Verb tables:** `grammar.verb.present` and `grammar.verb.past` hold six persons each
  (`PROMPT_VERSION` 3). Post-validation drops a whole table if any slot is empty. Older cached
  entries have no tables, and the intro falls back to `formsLine`.
- **Learn intro** has two steps: the source word, then the target word with its grammar. Arrow
  keys, swipe and the ←/→ buttons move through the steps. Going back only replays local state (a
  "got it" writes nothing), and back is cleared once a review is written.
- **Deviation:** Enter on an empty answer does nothing (use "Show answer"), to avoid an accidental
  Again.

## Grading from answer time (replaces the four grade buttons as the main UI)
- **Measured** in AnswerInput (`src/client/lib/answerTiming.ts` VisibleClock, paused while
  `document.hidden`): thinkMs = answer box ready -> first keystroke or speech start; typeMs = first
  input -> correct answer (none for a spoken answer). Each capped at 60 s (`TIMING_CAP_MS`).
- **Par** (`src/shared/answerTiming.ts`, pure, unit-tested): points of the expected answer (the
  matched one) = 1 per letter, +2 per letter outside a-z (the language's answerFolds: ä ö ü ß,
  accents), +1 per space/hyphen, +2 when the article is required; typePar = points x secPerPoint.
- **Calibration per device** (localStorage `flashy.answerTiming.v1`, every access in try/catch),
  separately for touch (`pointer: coarse`) and keyboard: moving averages (alpha 0.2) of
  secPerPoint (typed answers) and thinkMs, from correct, uncapped answers within 4x of the current
  estimate. Defaults 0.35 s/pt keyboard, 0.6 touch, think 2.5 s, blended in until 5 samples.
- **Grade:** wrong / article mistake / Show answer Again; typo Hard; correct and (think >
  max(8 s, 2.5 x typical) or type > 2 x par) Hard; correct, think <= max(1.5 s, 0.6 x typical)
  and type <= par (or spoken) Easy; else Good. Thresholds are exported constants.
- **UI:** the back shows "Good · 2.1 s" (grade colour) with Next (Enter accepts it), "Change"
  (opens the grade buttons, same height, nothing moves) and "I was right" (Good) for wrong/typo
  verdicts; keys 1-4 override at any time. The e2e suite freezes the clock through
  `window.__answerClock` (read by `answerNow`) to make the grades deterministic.

## No-AI dictionary (curated en→de, user-entered meanings)
- **Decision (owner):** no runtime AI for now. The German content is a hand-written, proofread
  dictionary: `data/seed/de/batch-{1,2,3}.json` (417 entries) + `src/worker/ai/devLexicon.de.ts`
  (203), together `CURATED_DE_BASE`, plus batch-4 (103, see "A2 additions") = `CURATED_DE` (`src/worker/ai/curated.de.ts`, bundled into the Worker; throws on a
  duplicate lemma key). It covers the 600 lemmas of `data/seed/de/lemmas.json`. The fake generator
  falls back to it (its hard-coded test words Hund/Katze/Haus/gehen/essen stay first; those are not
  part of `CURATED_DE`, so the seeded rows are the curated ones).
- **Seed:** `npm run seed:sql` (`scripts/curated-to-sql.ts`) writes `migrations/0003_seed_de.sql`:
  entries with ids `cur-de-<lemma_key>`, `model='curated'`, upserted (curated wins over stale local
  fake rows; the id of an existing row is kept, so aliases look the id up); aliases with
  `INSERT OR REPLACE`. Target aliases: the lemma key, plus the bare word-list form ("erinnern" →
  sich erinnern). Source aliases: termKey and glossKey of the translation and alternatives. Every
  entry must pass ItemSchema + validateItem unchanged; any listed lemma without an entry fails.
  `curated.test.ts` fails when the committed SQL differs from a regeneration.
- **Alias conflicts** (271 source keys, one entry per key): a primary translation beats an
  alternative, then the lower word-list rank. Hand-picked winners (`SOURCE_WINNERS`): boss → Chef,
  doctor → Arzt, idea → Idee, information → Information, one → eins, right → richtig, sick →
  krank, there → dort, watch → Uhr, when → wann. Other notable outcomes kept as the rule decides:
  go/to go → gehen (not fahren), know → wissen, take → nehmen, no → nein, you → du, it → es,
  work → Arbeit (to work → arbeiten), like → mögen, put → stellen.
- **Data fixes during validation:** Gott, hin (devLexicon) and wohin (batch-2) had an alternative
  with the same gloss key as the translation ("god"/"God", "to there"/"there", "where"/"where (to)"),
  which post-validation drops; the alternative was removed.
- **Status:** a miss is `status='failed'`, `gen_error='needs_meaning'` (no schema change; queues
  already exclude failed cards). /generate no longer 503s without AI. Retry skips needs_meaning;
  `stats.needsMeaning` drives the "N words need a meaning" banner. Every failed card shows
  "Needs meaning" and can take a user meaning.
- **User meaning:** `POST /cards/:id/meaning` stores `{lemma, pos, translation, grammar:{gender,
  article}, examples}` in `override_json` with `entry_id` NULL (never in the shared cache). A
  leading article sets the gender. Guarded like /generate's ready UPDATE → 409 `already_in_deck`.
  `input_side` follows the declared input language (auto input: compares keys). PATCH can't clear
  the translation of such a card.
- **Suggest:** `suggestSkipLemmas` (ich sie der du es wir er ein ja ihr nein sich man) and
  `suggestCuratedOnly` in `languages.ts`; a pair without curated entries uses the whole list.
- **Changing the dictionary later:** seed migrations are *stages* (`SEED_STAGES` in
  `scripts/curated-to-sql.ts`). 0003 stays the base dictionary (`CURATED_DE_BASE`); a later stage
  holds only the entries and alias rows that are new or point elsewhere (`curatedDeltaSql`, same
  upsert / INSERT OR REPLACE). `npm run seed:sql` rewrites every stage file; curated.test.ts checks
  each file against a regeneration and that 0003 + 0005 give the same tables as the whole
  dictionary at once. Removing an entry or alias key needs a hand-written migration.

## A2 additions (batch-4, migration 0005)
- **103 new entries** in `data/seed/de/batch-4.json` (34 nouns, 33 verbs, 18 adjectives/adverbs,
  18 phrases), so the owner's 148-line A2 import list (`test/fixtures/german-a2-words.txt`) is all
  Ready. "sich fühlen" is no new entry: the existing fühlen entry covers it (its note), via an
  extra target alias (`A2_TARGET_ALIASES`). leihen: primary "to lend" (the bare verb's meaning),
  "to borrow" an alternative (the note explains sich etwas leihen).
- **Phrases** use `pos: 'phrase'`, no grammar but a note. validateItem keeps a phrase's first word
  even when it is an article ("Das macht nichts.", "Einen Moment, bitte."); articleColor colours
  only "article + one word", so a phrase is not shown as a neuter noun. The answer check
  (`Expected.isPhrase`, from pos) ignores punctuation, apostrophes and "…" anywhere and does not
  split a phrase on commas; a trailing "…" is ignored for every answer.
- **Key variants** (stages after 0003): every alias key also without final punctuation/ellipsis
  ("es tut mir leid", "wie gefällt dir"), with ASCII apostrophes ("i'm sorry"; this also adds
  "o'clock" etc. for older entries), and reflexive lemmas without "sich " ("anmelden"). A variant
  never beats a real key and yields silently on the target side. Answers: German
  `answerStripPrefixes: ['sich ']`, so "anmelden" = "sich anmelden" both ways.
- **Collisions** (35 new source-side conflicts). Hand picks (`A2_SOURCE_WINNERS`): rubbish → Müll
  (not Mist), on time → pünktlich (not rechtzeitig), usually → meistens (not sonst). By the rule,
  older entries keep: begin/to begin and start → anfangen, change → ändern, save → retten (sparen
  is "to save (money)"), together → zusammen, quiet → ruhig, open → offen (to open → öffnen), rest
  → Rest (to rest → sich ausruhen), catch → fangen, fetch → holen, book → Buch, take → nehmen,
  last → letzte (to last → dauern), opportunity → Chance, happy → glücklich, hard → hart.
  New entries win: difficult → schwierig (over schwer's alternative), hurt/to hurt → wehtun (over
  verletzen's alternative), inside → drinnen, pick up → abholen, reach → erreichen. "cold" →
  Erkältung (no kalt entry exists yet).
- **Re-queue:** 0005 ends with an UPDATE that turns en→de cards with `status='failed'`,
  `gen_error='needs_meaning'` and no `override_json` back into pending (attempts and lease
  cleared); the next /generate serves dictionary hits as ready and marks the rest needs_meaning
  again (noAi.test.ts).

## Themes

- **Per-device theme** (Settings → Theme): System (default), Light, Dark, Sepia, Solarized Light,
  Nord, Dracula. Stored in localStorage `flashy.theme.v1` (not in the account: a phone and a
  laptop can differ); unreadable or unknown values fall back to System.
- **`dark:` is selector-based**: `@custom-variant dark (&:where([data-dark], [data-dark] *))`.
  `<html>` gets `data-theme="<id>"` and `data-dark` for Dark/Nord/Dracula and for System on a dark
  OS (lib/theme.ts follows `prefers-color-scheme` changes).
- **Themes remap Tailwind's palette variables** in styles.css (`--color-zinc-*`, `--color-white`
  for the light ones, and `--color-red-400`/`--color-blue-400` on Nord/Dracula where the defaults
  miss AA), so components keep their zinc classes. The primary colour is a new `accent` /
  `on-accent` pair (primary buttons, switches, the selected theme): zinc-900/white or
  zinc-100/zinc-900 by default, the theme's accent otherwise. Solarized's blue is darkened
  (#1f72ad) so base3 text on it passes AA. e2e/themes.spec.ts runs axe on Settings, Home and
  Train (answering, wrong answer, grade buttons) in every theme.
- **No flash**: public/theme-init.js, a classic blocking script in `<head>`, applies the stored
  theme and `<meta name="theme-color">` before first paint. It is external rather than inline so
  a future CSP needs no `'unsafe-inline'` (there is no CSP today). It duplicates the theme ids and
  backgrounds of lib/themeInfo.ts; test/client/theme.test.ts fails when they drift.

## App language (English / Español)

- **One setting, two jobs.** `users.settings_json.uiLang` (`'en'` | `'es'`, `UI_LANGUAGES` in
  `src/shared/languages.ts`) is the language of the app's text AND the source ("I speak")
  language of the user's decks. The new-deck form only asks "I'm learning"; the source is the
  app language.
- **First login:** the language comes from the browser's `Accept-Language`
  (`uiLanguageFromPreferences`, first listed app language by quality, else English). The first
  deck is then `es -> de` named "Alemán". Existing users have no `uiLang` stored and read as `'en'`.
- **Switching converts decks, never deletes** (`src/worker/services/switchLanguage.ts`, one read
  plus one `db.batch` with the new settings, so it's all or nothing):
  - `decks.source_lang` becomes the new language. A deck whose target is the new language (an
    en -> es deck when switching to Spanish) is left alone.
  - Cards keep their id, FSRS state and review logs. `entry_id` moves to the same German lemma's
    entry in the new pair (same target, `lemma_key`, `sense_key`). No counterpart: the old entry stays.
  - The user's own text is kept as typed: `override_json` (typed/edited meanings and sentences)
    and `extra_translations_json`. So a meaning typed in English stays English after the switch.
  - `needs_meaning` cards without a user meaning go back to `pending` (the new dictionary may know them).
  - `card_glosses` are rebuilt with the new language's gloss keys (duplicates, "Also in your deck").
  - A deck still named by its default ("German") is renamed ("Alemán"), and back.
- **Spanish dictionary (es -> de):** the same 723 German entries; only the Spanish side differs.
  `data/seed/de/es/{dev,batch-1..4}.json` hold `{ lemma, translation, alt_translations,
  example_source, note }` per entry, same order as the German source (checked by `withSpanish`
  in `curated.de.ts`). `CURATED_ES_DE` = German entry + Spanish side (the note replaces
  `grammar.note`). Rules: Spain Spanish; nouns without article ("casa"); verbs infinitive;
  adjectives masculine with the feminine as an alt; no `,` `;` `/` in a translation (they split
  answers); examples translate the German sentence. Ids are `cur-es-de-<lemma_key>` (the en ids
  stay `cur-de-*`). Seeded by `migrations/0006_seed_es_de.sql`, a new stage of
  `scripts/curated-to-sql.ts` (stages now carry a `pair`; deltas are per pair; 0003/0005 are
  byte-identical). Spanish alias conflicts that the rank rule got wrong are fixed in
  `ES_SOURCE_WINNERS` (apenas -> kaum, jefe -> Chef, tío -> Onkel, tarde -> spät, ...).
  Written with AI help at authoring time and checked by tests (same German side, valid markers,
  no articles on nouns); no runtime AI.
- **UI text:** no i18n library. `src/client/lib/i18n.tsx`: each file keeps
  `messages(en, es)` next to its code (TypeScript requires the same keys on both sides);
  `useT(M)` picks the app language (browser language before /me has loaded). Shared helpers that
  return text take a `ui` parameter defaulting to `'en'` (existing tests unchanged). Language
  names come from `LanguageConfig.uiNames`. `<html lang>` follows the app language.
  Not translated: server error messages (rare; shown as sent) and the YouTube pronunciation search.
- **Migration order:** 0006 only adds rows, so it is safe with the old code; the new code works
  without 0006 too (an es deck would just get "Needs meaning").

## Imports go to Train

- **What:** imported words (Add words → Import) skip Learn and are due in Train at once. Suggested
  words ("Add new words") are new vocabulary and still go to Learn.
- **Per card, not per deck query:** `cards.skip_learn` (migration 0007, default 0) is set at import
  time. A never-studied card (state 0) with `skip_learn = 1` is in Train (`IN_TRAIN` in
  `db/cards.ts`), not in Learn, not in the `new` count, and counts in `dueNow`/`dueToday`. Its
  first review doesn't use up the daily Learn limit (`NEW_TODAY_SQL` skips it). A word imported
  without a dictionary meaning goes to Train once the user types the meaning.
- **Existing decks unchanged:** the deck setting `importToTrain` decides at import time.
  `DEFAULT_DECK_SETTINGS` (the fallback for settings missing from a stored deck) has it off, so
  decks made before keep sending imports to Learn; `NEW_DECK_SETTINGS` (POST /decks and a new
  user's first deck) has it on. Settings → the deck → "Imported words go straight to Train"
  switches it; it never moves words already imported.
- **Tests:** worker tests of the Learn path and the e2e baseline deck use importToTrain off (a deck
  "made before"); `test/worker/importToTrain.test.ts` and `e2e/import-to-train.spec.ts` cover it on.
- **Migration order:** 0007 only adds a column with a default; the deployed code's inserts name
  their columns, so it keeps working before the new code is live.

## Typing on a phone (keyboard covering the word)

- **Problem:** Learn and Train are fixed full-height screens with the word in the middle of a tall
  card and the answer box near the bottom. Opening the on-screen keyboard made the browser scroll
  the box into view, pushing the word off the top.
- **Fix:** `lib/keyboard.ts` detects the keyboard from `window.visualViewport`: a text field has
  focus and the visible height is under 80% of the tallest seen at this width (not while
  pinch-zoomed; the pure rule is `keyboardState.ts`, unit-tested). While it is open, a `fill`
  Screen covers exactly the visible area (visualViewport top/height) and goes compact:
  `hideWhileTyping` hides the header, the direction tabs and the "N left" lines; the card and the
  footer drop their min-heights; the TabBar is not rendered. The word then sits right above the box.
- `index.html` sets `interactive-widget=resizes-content`, so Chrome on Android shrinks the page
  for the keyboard (Safari on iOS ignores it and pans the visible area, which the visualViewport
  top/height handle).
- **Verified:** e2e `keyboard.spec.ts` emulates the Android behaviour (focus the box, shrink the
  viewport to 430 px). A real keyboard, and iOS Safari, can only be checked on a device.

## App icon and name

- The app is installable because it has a web app manifest (`public/manifest.webmanifest`,
  "M8+M9"): Chrome offers "Install" for an HTTPS site with a manifest, a name and icons.
- Name: **FlashyCards** (manifest, `<title>`, iOS title, Home, About, How-to).
- Icon: Real Betis green (#0bb363) with a gold card behind a white "Hallo" card
  (`public/icon.svg`). `scripts/gen-icons.ts` renders the PNGs (192, 512, Apple 180, maskable 512
  with a green full-bleed background). The manifest lists only the PNGs, so the installed icon
  doesn't depend on the phone's fonts; the SVG stays the browser-tab favicon.
- An already installed app picks up a new icon/name when Chrome next checks the manifest (can take
  a day); uninstalling and installing again shows it at once. iOS keeps the icon it was added with.
