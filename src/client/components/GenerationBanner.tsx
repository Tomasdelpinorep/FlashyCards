/** Progress of looking words up, the daily-limit message, "needs a meaning" and "Retry failed". */
import { Link } from 'react-router'
import type { DeckStats } from '../../shared/schemas'
import { AI_NOT_CONFIGURED, useGeneration } from '../lib/generation'
import { bannerProgress } from '../lib/generationState'
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
  const needsMeaning = stats?.needsMeaning ?? 0
  // needs_meaning cards are not retried (the dictionary still won't know them): only the others.
  const retryable = (stats?.failed ?? 0) - needsMeaning
  const progress = bannerProgress(state, pending)

  return (
    <>
      {progress && (
        <div className="flex flex-col gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
          <p>
            Looking up {words(progress.total)}… {progress.done}/{progress.total}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900" aria-hidden="true">
            <div className="h-full rounded-full bg-amber-600 transition-[width] dark:bg-amber-400" style={{ width: `${Math.round((100 * progress.done) / progress.total)}%` }} />
          </div>
        </div>
      )}
      {!state.running && pending > 0 && !state.rateLimited && !state.error && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
          Looking up {words(pending)}…
        </p>
      )}
      {state.rateLimited && pending > 0 && (
        <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900" role="status">
          Daily limit for new words reached. {words(pending)} will be looked up after{' '}
          {state.limitResetsAt ? resetTime(state.limitResetsAt) : 'midnight (UTC)'}.
        </p>
      )}
      {state.error && pending > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200" role="alert">
          <span>{state.error === AI_NOT_CONFIGURED ? `${AI_NOT_CONFIGURED} (${words(pending)} waiting.)` : `Couldn't look up words: ${state.error}`}</span>
          <button type="button" className="-my-2 min-h-11 shrink-0 px-2 font-medium underline" onClick={() => start()}>
            Try again
          </button>
        </div>
      )}
      {needsMeaning > 0 && !state.running && (
        <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900" data-testid="needs-meaning">
          {words(needsMeaning)} need{needsMeaning === 1 ? 's' : ''} a meaning –{' '}
          <Link to="/words?status=failed" className="font-medium underline">
            add it in Words
          </Link>
        </p>
      )}
      {retryable > 0 && !state.running && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
          <span>{words(retryable)} couldn't be looked up.</span>
          <button
            type="button"
            className="-my-2 min-h-11 shrink-0 px-2 font-medium underline disabled:opacity-40"
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
