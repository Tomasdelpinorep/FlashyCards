/**
 * The client-side generation loop (PLAN.md section 2, step 3-4): calls POST /generate until
 * `remaining` is 0. It starts after an import, resumes on load when the deck still has pending
 * cards, stops (with a message) when the daily AI limit is reached, and backs off when a call
 * makes no progress (another tab/request holds the lease, or a transient AI error).
 */
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from './api'
import { useCurrentDeck } from './deck'
import { IDLE, shouldResume, startState, type GenerationState } from './generationState'
import { generateOnce, keys, useDeckStats } from './queries'

export type { GenerationState }

const NO_PROGRESS_DELAY_MS = 3000
const MAX_IDLE_ROUNDS = 40 // ~2 minutes without progress -> give up until the next trigger

/** `start({ fresh: true })` after a new import or suggestion: forgets earlier runs' duplicates. */
type Ctx = { state: GenerationState; start: (opts?: { fresh?: boolean }) => void }
const GenerationContext = createContext<Ctx>({ state: IDLE, start: () => {} })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function GenerationProvider({ children }: { children: ReactNode }) {
  const { deck } = useCurrentDeck()
  const deckId = deck?.id
  const stats = useDeckStats(deckId)
  const qc = useQueryClient()
  const [state, setState] = useState<GenerationState>(IDLE)
  const run = useRef<{ deckId: string; cancelled: boolean } | null>(null)
  // When the last run ended (ms); stats fetched before that are stale for resuming.
  const lastRunEndedAt = useRef(0)

  // A different deck: stop the old loop and start from scratch.
  useEffect(() => {
    setState(IDLE)
    return () => {
      if (run.current) run.current.cancelled = true
      run.current = null
    }
  }, [deckId])

  const start = useCallback((opts?: { fresh?: boolean }) => {
    if (!deckId || (run.current && !run.current.cancelled)) return
    const me = { deckId, cancelled: false }
    run.current = me
    setState((s) => startState(s, opts?.fresh ?? false))
    void (async () => {
      let idle = 0
      let done = 0
      try {
        while (!me.cancelled) {
          const r = await generateOnce(deckId)
          if (me.cancelled) return
          done += r.processed
          setState((s) => ({
            ...s,
            done,
            total: done + r.remaining,
            rateLimited: r.rateLimited,
            limitResetsAt: r.limitResetsAt ?? null,
            duplicates: [...s.duplicates, ...r.duplicates],
          }))
          if (r.processed > 0 || r.remaining === 0) void qc.invalidateQueries({ queryKey: keys.deck(deckId) })
          if (r.remaining === 0 || r.rateLimited) break
          idle = r.processed > 0 ? 0 : idle + 1
          if (idle >= MAX_IDLE_ROUNDS) break
          if (idle > 0) await sleep(NO_PROGRESS_DELAY_MS)
        }
      } catch (err) {
        if (!me.cancelled) setState((s) => ({ ...s, error: generationErrorText(err) }))
      } finally {
        if (run.current === me) {
          run.current = null
          lastRunEndedAt.current = Date.now()
          setState((s) => ({ ...s, running: false }))
        }
      }
    })()
  }, [deckId, qc])

  // Resume on load (and whenever pending cards appear), unless the daily limit or an error stopped us.
  const pending = stats.data?.pending ?? 0
  const limited = state.rateLimited && state.limitResetsAt !== null && Date.now() < state.limitResetsAt
  const statsUpdatedAt = stats.dataUpdatedAt
  useEffect(() => {
    if (shouldResume({ pending, running: state.running, limited, error: state.error, statsUpdatedAt, lastRunEndedAt: lastRunEndedAt.current })) {
      start()
    }
  }, [pending, state.running, limited, state.error, statsUpdatedAt, start])

  return <GenerationContext.Provider value={{ state, start }}>{children}</GenerationContext.Provider>
}

/** The banner text for a failed /generate call (503 ai_not_configured has its own copy). */
export function generationErrorText(err: unknown): string {
  if (isAiUnavailable(err)) return AI_NOT_CONFIGURED
  return err instanceof Error ? err.message : String(err)
}

/** 503 ai_not_configured (no key on the server) or ai_unavailable (the AI call failed). */
export function isAiUnavailable(err: unknown): boolean {
  return err instanceof ApiError && (err.body?.error === 'ai_not_configured' || err.body?.error === 'ai_unavailable')
}

/**
 * Shown when a /generate call answers 503 (an older server, or an AI call that failed): the cards
 * stay 'pending' and the loop resumes by itself whenever the app loads with pending cards
 * (shouldResume). Without AI the current server never 503s: dictionary misses become
 * "Needs meaning".
 */
export const AI_NOT_CONFIGURED =
  "Word details can't be generated right now. Your words are saved and will be filled in automatically once it's available (next time you open the app)."

/** AddWords: /suggest without a word list needs the AI; nothing was added. */
export const SUGGEST_UNAVAILABLE = "New word suggestions aren't available right now. You can still add your own words in the Import tab."

export function useGeneration() {
  return useContext(GenerationContext)
}
