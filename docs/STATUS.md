# Project status (handoff)

Last updated: 2026-11-21

## Done (on `main`)
- **M1–M7 are complete and pushed:**
  - scaffold
  - Cloudflare Access auth and decks
  - import and duplicate handling (`DUPLICATES.md`)
  - AI generation with a cache and rate limit (fake + Haiku providers)
  - FSRS training mode
  - the learn-new flow
  - "Add X new words" with a 5,057-lemma German list
- **QA pass, partial.** Commit `5b0a07e` is **not pushed yet**.
  - Playwright e2e covers first run and import. The tests run on mobile only, against an isolated state in `.wrangler/e2e-state`.
  - The pass found 6 bugs, all fixed. Details are in `DECISIONS.md` under "M8-QA".

## Next steps, in order
1. Run `npm run build`, then push `5b0a07e`.
2. **Lean M8+M9 pass.** This merges the original M8 and M9 into one milestone with a reduced scope:
   - About page with the word-list attribution (`LanguageConfig.wordlist`)
   - card edit (translation, sentence, note, extra translations; rewrite `card_glosses`) and suspend
   - Settings toggles for `hideSentenceOnFront` and `ttsAutoplay`
   - PWA manifest and icons
   - fixes for the open QA items:
     - tap targets under 44px
     - guidance on an empty deck instead of bare zeros
     - e2e specs for Add words, Learn, Train, and the offline outbox
   - one check with an en→es deck to confirm nothing German-specific lives outside `languages.ts`
   - **Out of scope:** sentence regenerate, Lighthouse, desktop e2e, a full architect review. At most, do a short review of the risky parts.

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
