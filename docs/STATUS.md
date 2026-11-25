# Project status (handoff)

Last updated: 2026-11-23

## Done (on `main`)
- **M1–M7 are complete and pushed:**
  - scaffold
  - Cloudflare Access auth and decks
  - import and duplicate handling (`DUPLICATES.md`)
  - AI generation with a cache and rate limit (fake + Haiku providers)
  - FSRS training mode
  - the learn-new flow
  - "Add X new words" with a 5,057-lemma German list
- **M8+M9 (lean)** is done: edit/suspend, About, Settings toggles, PWA manifest and icons, QA fixes, en→es check.
- **Learn/Train redesign** (not pushed):
  - Train and the Learn quick check use typed or spoken answers, auto-graded with an override.
  - Learn has a two-step intro with verb tables (prompt v3).
  - Details are in `DECISIONS.md` under "Learn/Train redesign".
- **QA pass:** commit `5b0a07e`.
  - Playwright e2e covers first run and import. The tests run on mobile only, against an isolated state in `.wrangler/e2e-state`.
  - The pass found 6 bugs, all fixed. Details are in `DECISIONS.md` under "M8-QA".

- **No-AI dictionary** (not pushed; `DECISIONS.md` "No-AI dictionary"):
  - No runtime AI: a hand-written, checked en→de dictionary of 620 entries (the 600 chosen
    word-list lemmas plus extras), seeded by `migrations/0003_seed_de.sql` (`npm run seed:sql`).
  - Words it doesn't know show "Needs meaning"; the user types the meaning on the word page.
  - "Add new words" suggests only dictionary words (skipping ich, sie, der, ...), ready at once.
- **A2 additions** (not pushed; `DECISIONS.md` "A2 additions"): 103 more entries incl. 18 set
  phrases (`data/seed/de/batch-4.json`), shipped as `migrations/0005_seed_de_a2.sql` (only the
  additions; it also re-queues needs_meaning cards). The 148-word A2 test list imports all Ready.

## Next steps, in order
1. Push the M8+M9 commit. It is committed on `main` but not pushed, and not deployed.
   - It covers card edit and suspend, the About page, the Settings toggles, the PWA manifest (no service worker), the QA fixes and the en→es check (`DECISIONS.md` "M8+M9").
   - The e2e suite now also covers add words, learn, train, offline, card edit, settings and About.
2. Run `npm run db:migrate:remote` (adds the dictionary: 0003 and 0005), THEN `npm run deploy`. Production still runs the previous build.
3. Optional: swap a few film-heavy dictionary words (Mörder, Leiche, Agent, ...) for everyday ones:
   put the changes in a new batch + a new stage in `SEED_STAGES` (scripts/curated-to-sql.ts),
   run `npm run seed:sql`, commit, migrate. Applied seed migrations are never rewritten.

## Working rules
- **Agents:** the orchestrator delegates design to an architect agent and code to a developer agent, all on Opus.
- **Keep token use low:**
  - Agents read only the doc sections they need.
  - Agents run the full test suites once, at the end.
  - Agents keep their reports short.
- **The repo is public:**
  - Never commit secrets or real emails.
  - `ALLOWED_EMAILS` and `ANTHROPIC_API_KEY` are Worker secrets, and live in `.dev.vars` locally.
  - The repo-local git email is the GitHub no-reply address.

## Blocked on the owner (needed to deploy)
- a Cloudflare account and Zero Trust (team domain, Access app AUD)
- the allowlist emails
- (no longer needed: an Anthropic key; the app runs on the curated dictionary)
- deploy steps are in PLAN.md §9
