import { useCallback, useEffect, useState } from 'react'

type Health = { ok: boolean; time: string }
type State = { status: 'loading' } | { status: 'ok'; data: Health } | { status: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

  const check = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState({ status: 'ok', data: (await res.json()) as Health })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  return (
    <div className="min-h-dvh bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-4 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Flashcards</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">German vocabulary, one card at a time.</p>
        </header>

        <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800" aria-live="polite">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">API status</h2>
          {state.status === 'loading' && <p className="mt-2">Checking…</p>}
          {state.status === 'ok' && (
            <div className="mt-2">
              <p className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
                <span className="size-2 rounded-full bg-current" aria-hidden />
                {state.data.ok ? 'Online' : 'Not OK'}
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Server time: <time dateTime={state.data.time}>{new Date(state.data.time).toLocaleString()}</time>
              </p>
            </div>
          )}
          {state.status === 'error' && (
            <p className="mt-2 font-medium text-red-700 dark:text-red-400">Unreachable ({state.message})</p>
          )}
        </section>

        <button
          type="button"
          onClick={() => void check()}
          className="h-12 w-full rounded-xl bg-zinc-900 font-medium text-white active:scale-[0.99] dark:bg-zinc-100 dark:text-zinc-900"
        >
          Check again
        </button>
      </main>
    </div>
  )
}
