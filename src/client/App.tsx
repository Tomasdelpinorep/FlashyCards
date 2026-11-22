import { Navigate, Route, Routes } from 'react-router'
import { TabBar } from './components/TabBar'
import { btnPrimary, ErrorText } from './components/ui'
import { DeckProvider } from './lib/deck'
import { GenerationProvider } from './lib/generation'
import { getOutbox } from './lib/outbox'
import { useMe } from './lib/queries'
import { useEffect } from 'react'
import { About } from './screens/About'
import { AddWords } from './screens/AddWords'
import { CardDetail } from './screens/CardDetail'
import { Home } from './screens/Home'
import { Learn } from './screens/Learn'
import { Settings } from './screens/Settings'
import { Train } from './screens/Train'
import { Words } from './screens/Words'

export default function App() {
  const me = useMe()
  // Drain reviews left in the outbox by an earlier visit (also retries on `online`).
  useEffect(() => void getOutbox(), [])

  return (
    <div className="min-h-dvh bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto w-full max-w-[480px] px-4 pt-6 pb-28">
        {me.isPending && <p className="py-10 text-center text-zinc-500">Loading…</p>}
        {me.isError && (
          <div className="flex flex-col gap-4 py-10">
            <ErrorText error={me.error} />
            <button type="button" className={btnPrimary} onClick={() => void me.refetch()}>
              Try again
            </button>
          </div>
        )}
        {me.isSuccess && (
          <DeckProvider decks={me.data.decks}>
            <GenerationProvider>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/words" element={<Words />} />
              <Route path="/words/:id" element={<CardDetail />} />
              <Route path="/add" element={<AddWords />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/about" element={<About />} />
              <Route path="/train" element={<Train />} />
              <Route path="/learn" element={<Learn />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </GenerationProvider>
          </DeckProvider>
        )}
      </main>
      <TabBar />
    </div>
  )
}
