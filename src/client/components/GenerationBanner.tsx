/** Progress of example-sentence generation, the daily-limit message and "Retry failed". */
import type { DeckStats } from '../../shared/schemas'
import { useGeneration } from '../lib/generation'
import { useRetryFailed } from '../lib/queries'
import { ErrorText } from './ui'

const words = (n: number) => `${n} word${n === 1 ? '' : 's'}`

function resetTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function GenerationBanner({ deckId, stats }: { deckId: string; stats: DeckStats | undefined }) {
  const { state, start } = useGeneration()
  const retry = useRetryFailed(deckId)
  const pending = stats?.pending ?? 0
  const failed = stats?.failed ?? 0

  return (
    <>
      {state.running && state.total > 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
          <p>
            Preparing {words(state.total)}… {state.done}/{state.total}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900" aria-hidden="true">
            <div className="h-full rounded-full bg-amber-600 transition-[width] dark:bg-amber-400" style={{ width: `${Math.round((100 * state.done) / state.total)}%` }} />
          </div>
        </div>
      )}
      {!state.running && pending > 0 && !state.rateLimited && !state.error && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
          Preparing {words(pending)}…
        </p>
      )}
      {state.rateLimited && pending > 0 && (
        <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900" role="status">
          Daily limit for new words reached. {words(pending)} will be prepared after{' '}
          {state.limitResetsAt ? resetTime(state.limitResetsAt) : 'midnight (UTC)'}.
        </p>
      )}
      {state.error && pending > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200" role="alert">
          <span>Couldn't prepare words: {state.error}</span>
          <button type="button" className="shrink-0 font-medium underline" onClick={start}>
            Try again
          </button>
        </div>
      )}
      {failed > 0 && !state.running && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
          <span>{words(failed)} couldn't be prepared.</span>
          <button
            type="button"
            className="shrink-0 font-medium underline disabled:opacity-40"
            disabled={retry.isPending}
            onClick={() => retry.mutate(undefined, { onSuccess: () => start() })}
          >
            {retry.isPending ? 'Retrying…' : 'Retry failed'}
          </button>
        </div>
      )}
      <ErrorText error={retry.error} />
    </>
  )
}
