/**
 * Pure pieces of the client generation loop (lib/generation.tsx), unit-tested without React.
 */
import type { DuplicateReport } from '../../shared/schemas'

export type GenerationState = {
  running: boolean
  /** Cards processed (ready, duplicate or failed) since the loop started. */
  done: number
  /** done + what is still pending (0 until the first /generate call of a run returns). */
  total: number
  rateLimited: boolean
  limitResetsAt: number | null
  error: string | null
  /** Duplicates found while generating (DUPLICATES.md 10.6 reason 'resolved'). */
  duplicates: DuplicateReport[]
}

export const IDLE: GenerationState = { running: false, done: 0, total: 0, rateLimited: false, limitResetsAt: null, error: null, duplicates: [] }

/**
 * The state when a run starts. `fresh` (a new import / "Add new words") clears the duplicates
 * found by earlier runs; an automatic resume keeps them, so a list the user is looking at
 * doesn't vanish when the loop picks up again.
 */
export function startState(prev: GenerationState, fresh: boolean): GenerationState {
  return { ...IDLE, running: true, duplicates: fresh ? [] : prev.duplicates }
}

/**
 * Whether the provider should resume the loop on its own. The stats must be newer than the end
 * of the last run: stats fetched while a run was going still count the cards it has since
 * prepared, and would otherwise start a second, pointless run.
 */
export function shouldResume(o: {
  pending: number
  running: boolean
  limited: boolean
  error: string | null
  statsUpdatedAt: number
  lastRunEndedAt: number
}): boolean {
  return o.pending > 0 && !o.running && !o.limited && !o.error && o.statsUpdatedAt > o.lastRunEndedAt
}

/**
 * Progress for the banner while the loop runs: before the first /generate call returns, the
 * total is not known from the loop yet, so the deck's pending count stands in (0/N).
 */
export function bannerProgress(state: GenerationState, pending: number): { done: number; total: number } | null {
  if (!state.running) return null
  if (state.total > 0) return { done: state.done, total: state.total }
  return pending > 0 ? { done: 0, total: pending } : null
}
