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
