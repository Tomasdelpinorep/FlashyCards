# Project status (handoff)

Last updated: 2026-11-22

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
- **QA pass:** commit `5b0a07e`.
  - Playwright e2e covers first run and import. The tests run on mobile only, against an isolated state in `.wrangler/e2e-state`.
  - The pass found 6 bugs, all fixed. Details are in `DECISIONS.md` under "M8-QA".

## Next steps, in order
1. Push the M8+M9 commit. It is committed on `main` but not pushed, and not deployed.
   - It covers card edit and suspend, the About page, the Settings toggles, the PWA manifest (no service worker), the QA fixes and the en→es check (`DECISIONS.md` "M8+M9").
   - The e2e suite now also covers add words, learn, train, offline, card edit, settings and About.
2. Redeploy with `npm run deploy`. Production still runs the previous build, and has no Anthropic key yet.
3. Run a real-AI quality check on about 20 words.

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
- an Anthropic API key with $5 of credit
- the allowlist emails
- once the key exists, a real-AI quality check on about 20 words
- deploy steps are in PLAN.md §9
