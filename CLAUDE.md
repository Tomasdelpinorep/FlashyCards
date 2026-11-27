# FlashyCards: notes for Claude

A German (en→de) flashcard PWA for the owner and two friends. Read this first; the full context
lives in `docs/`:

- `docs/STATUS.md`: what is built and what is open. Start here.
- `docs/DECISIONS.md`: why things are the way they are (answer checking, grading, themes, the
  no-AI dictionary, alias collision rules…). Add a short section when you make a real decision.
- `docs/PLAN.md`: the original spec (milestones M1–M9, all done). `docs/DUPLICATES.md`: duplicate rules.

## Hard rules

- **It must stay free.** Cloudflare free plan only (Workers, D1, Access, Workers Builds). No paid
  services, no paid APIs. There is no runtime AI: words come from a curated dictionary.
- **The repo is public.** Never commit secrets, API tokens, or real email addresses (the owner's
  or the friends'). `ALLOWED_EMAILS` is a Worker secret; local values live in the gitignored
  `.dev.vars`. `DEV_AUTH_EMAIL` only works on localhost and must never be set in production.
- Commits: end the message with `Co-Authored-By: Claude <noreply@anthropic.com>` (model name optional).
- Keep the user-facing How-to page (`src/client/screens/HowTo.tsx`) in sync with features.
- The app is in English and Spanish: every user-visible string goes through `messages(en, es)` /
  `useT` (`src/client/lib/i18n.tsx`). The app language is also the decks' source language.

## Stack

Cloudflare Workers + D1 (SQLite) + Cloudflare Access (one-time PIN, email allowlist), Hono API
(`src/worker`), React 19 + React Router + TanStack Query + Tailwind v4 client (`src/client`, the
Vite root), shared code in `src/shared` (answer checking, grading, languages, normalisation),
ts-fsrs scheduling, Zod, Vitest, Playwright (mobile viewport, axe accessibility checks).

## Commands

```sh
npm run dev               # local app on http://localhost:5173 (auth bypassed via .dev.vars)
npm run typecheck
npx vitest run            # unit + worker tests (~1000, fast)
npm run test:e2e          # Playwright, own server on 127.0.0.1:5180; only one run at a time
npm run build
npm run db:migrate:local  # apply migrations to the local D1
npm run db:reset:local    # wipe and re-migrate the local D1 (stop the dev server first)
npm run seed:sql -- <NNNN> # regenerate dictionary SQL (see docs/DECISIONS.md, "Changing the dictionary later")
```

Run typecheck, vitest, build and e2e before pushing a change to `main`.

## Deploying

Pushing to `main` deploys automatically (Cloudflare Workers Builds): it runs `npm run build`,
then applies pending D1 migrations to production, then deploys the Worker. So:

- **Every push to `main` goes live.** Work on a branch and open a pull request when the owner
  wants to review first.
- **Migrations run before the new code is live**, so a migration must work with the code that is
  currently deployed (additive changes only). If a migration needs new code (e.g. a new enum value
  the old code would reject), ship the code in one push and the migration in a later one.
- Never edit a migration that is already applied; add a new numbered file in `migrations/`.
- Manual fallback (owner's machine): `npm run deploy` (= build + `wrangler deploy --config
  dist/flashcards/wrangler.json`; the plain `wrangler deploy` fails because the Vite root is
  `src/client`) and `npm run db:migrate:remote`.

## The dictionary

The curated en→de dictionary is in `data/seed/de/batch-*.json` plus `src/worker/ai/devLexicon.de.ts`,
assembled in `src/worker/ai/curated.de.ts` and seeded by migrations 0003 and 0005. To add words:
add a new batch file in the same format, proofread it (genders, plurals, verb tables, Perfekt
auxiliaries, separable prefixes, example sentences), resolve English alias collisions with the
rules in DECISIONS.md, generate a new migration with only the new entries, and add tests like
`test/worker/curated.test.ts`. Spanish meanings for the same entries live in `data/seed/de/es/*.json` (one item per German entry,
same order) and are seeded as es→de by migration 0006; a new German batch needs its Spanish file too
(and a new es stage). Unknown words become "Needs meaning" and the user types the
meaning; that meaning is stored on their own card only (`cards.override_json`).

## How the owner likes to work

The owner is learning web development: explain things simply and concretely when asked. For
bigger changes, plan first, then implement, then verify with the tests and screenshots
(Playwright can save them) before reporting. Report results plainly, including anything not
verified (e.g. microphone and text-to-speech can't be tested without real hardware).
