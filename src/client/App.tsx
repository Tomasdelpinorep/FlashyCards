import { useCallback, useEffect, useState } from 'react'
import type { MeResponse } from '../shared/schemas'
import { api } from './lib/api'

type State = { status: 'loading' } | { status: 'ok'; data: MeResponse } | { status: 'error'; message: string }

// Placeholder until the real screens land (M3+): shows who is signed in and their decks.
export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await api.me.$get()
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState({ status: 'ok', data: await res.json() })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-h-dvh bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-4 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Flashcards</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">German vocabulary, one card at a time.</p>
        </header>

        <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800" aria-live="polite">
          {state.status === 'loading' && <p>Loading…</p>}
          {state.status === 'error' && (
            <p className="font-medium text-red-700 dark:text-red-400">Could not load your account ({state.message})</p>
          )}
          {state.status === 'ok' && (
            <>
              <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Signed in as</h2>
              <p className="mt-1 font-medium break-all">{state.data.user.email}</p>
              <h2 className="mt-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">Your decks</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {state.data.decks.map((deck) => (
                  <li key={deck.id} className="flex items-center justify-between rounded-xl bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
                    <span className="font-medium">{deck.name}</span>
                    <span className="text-sm text-zinc-500 uppercase dark:text-zinc-400">
                      {deck.sourceLang} → {deck.targetLang}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <button
          type="button"
          onClick={() => void load()}
          className="h-12 w-full rounded-xl bg-zinc-900 font-medium text-white active:scale-[0.99] dark:bg-zinc-100 dark:text-zinc-900"
        >
          Reload
        </button>
      </main>
    </div>
  )
}
