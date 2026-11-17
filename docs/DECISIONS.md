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
    Kept the spec's <= 7-rows form for now.

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

