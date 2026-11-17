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

- **Default deck.** Created by a single `INSERT ... SELECT ... WHERE NOT EXISTS` on `GET /me`
  when the user has no decks, so concurrent first requests cannot create two.
  To keep "first login" meaning first login, **`DELETE /decks/:id` refuses to delete the
  user's only deck (409)** instead of letting the next `/me` silently recreate "German".

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
