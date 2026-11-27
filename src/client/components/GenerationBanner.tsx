/** Progress of looking words up, the daily-limit message, "needs a meaning" and "Retry failed". */
import { Link } from 'react-router'
import type { DeckStats } from '../../shared/schemas'
import { AI_NOT_CONFIGURED, aiNotConfiguredText, useGeneration } from '../lib/generation'
import { bannerProgress } from '../lib/generationState'
import { messages, useT, useUiLang } from '../lib/i18n'
import { useRetryFailed } from '../lib/queries'
import { ErrorText } from './ui'

const M = messages(
  {
    lookingUp: (n: number) => `Looking up ${n} word${n === 1 ? '' : 's'}…`,
    limit: (n: number, when: string) => `Daily limit for new words reached. ${n} word${n === 1 ? '' : 's'} will be looked up after ${when}.`,
    midnight: 'midnight (UTC)',
    waiting: (n: number) => `(${n} word${n === 1 ? '' : 's'} waiting.)`,
    lookupError: (error: string) => `Couldn't look up words: ${error}`,
    tryAgain: 'Try again',
    needsMeaning: (n: number) => `${n} word${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a meaning –`,
    addInWords: 'add it in Words',
    couldNotLookUp: (n: number) => `${n} word${n === 1 ? '' : 's'} couldn't be looked up.`,
    retrying: 'Retrying…',
    retryFailed: 'Retry failed',
  },
  {
    lookingUp: (n) => (n === 1 ? 'Buscando 1 palabra…' : `Buscando ${n} palabras…`),
    limit: (n, when) =>
      `Has llegado al límite diario de palabras nuevas. ${n === 1 ? '1 palabra se buscará' : `${n} palabras se buscarán`} después de ${when}.`,
    midnight: 'medianoche (UTC)',
    waiting: (n) => (n === 1 ? '(1 palabra en espera.)' : `(${n} palabras en espera.)`),
    lookupError: (error) => `No se pudieron buscar las palabras: ${error}`,
    tryAgain: 'Reintentar',
    needsMeaning: (n) => (n === 1 ? '1 palabra necesita un significado –' : `${n} palabras necesitan un significado –`),
    addInWords: 'añádelo en Palabras',
    couldNotLookUp: (n) => (n === 1 ? '1 palabra no se pudo buscar.' : `${n} palabras no se pudieron buscar.`),
    retrying: 'Reintentando…',
    retryFailed: 'Reintentar las fallidas',
  },
)

function resetTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function GenerationBanner({ deckId, stats }: { deckId: string; stats: DeckStats | undefined }) {
  const t = useT(M)
  const ui = useUiLang()
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
            {t.lookingUp(progress.total)} {progress.done}/{progress.total}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900" aria-hidden="true">
            <div className="h-full rounded-full bg-amber-600 transition-[width] dark:bg-amber-400" style={{ width: `${Math.round((100 * progress.done) / progress.total)}%` }} />
          </div>
        </div>
      )}
      {!state.running && pending > 0 && !state.rateLimited && !state.error && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
          {t.lookingUp(pending)}
        </p>
      )}
      {state.rateLimited && pending > 0 && (
        <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900" role="status">
          {t.limit(pending, state.limitResetsAt ? resetTime(state.limitResetsAt) : t.midnight)}
        </p>
      )}
      {state.error && pending > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200" role="alert">
          <span>{state.error === AI_NOT_CONFIGURED ? `${aiNotConfiguredText(ui)} ${t.waiting(pending)}` : t.lookupError(state.error)}</span>
          <button type="button" className="-my-2 min-h-11 shrink-0 px-2 font-medium underline" onClick={() => start()}>
            {t.tryAgain}
          </button>
        </div>
      )}
      {needsMeaning > 0 && !state.running && (
        <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900" data-testid="needs-meaning">
          {t.needsMeaning(needsMeaning)}{' '}
          <Link to="/words?status=failed" className="font-medium underline">
            {t.addInWords}
          </Link>
        </p>
      )}
      {retryable > 0 && !state.running && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
          <span>{t.couldNotLookUp(retryable)}</span>
          <button
            type="button"
            className="-my-2 min-h-11 shrink-0 px-2 font-medium underline disabled:opacity-40"
            disabled={retry.isPending}
            onClick={() => retry.mutate(undefined, { onSuccess: () => start() })}
          >
            {retry.isPending ? t.retrying : t.retryFailed}
          </button>
        </div>
      )}
      <ErrorText error={retry.error} />
    </>
  )
}
