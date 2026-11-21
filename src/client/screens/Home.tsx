import { Link } from 'react-router'
import { GenerationBanner } from '../components/GenerationBanner'
import { NoDecks } from '../components/NoDecks'
import { btnPrimary, btnSecondary, card, ErrorText, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useDeckStats } from '../lib/queries'

export function Home() {
  const { deck, decks, selectDeck } = useCurrentDeck()
  const stats = useDeckStats(deck?.id)

  if (!deck) {
    return (
      <Screen title="Flashcards">
        <NoDecks />
      </Screen>
    )
  }

  const s = stats.data
  return (
    <Screen
      title="Flashcards"
      action={
        decks.length > 1 ? (
          <label className="flex items-center">
            <span className="sr-only">Deck</span>
            <select
              className="max-w-44 truncate rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900"
              value={deck.id}
              onChange={(e) => selectDeck(e.target.value)}
            >
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{deck.name}</span>
        )
      }
    >
      <ErrorText error={stats.error} />

      <GenerationBanner deckId={deck.id} stats={s} />
      {s && s.duplicates > 0 && (
        <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
          {s.duplicates === 1 ? '1 word was' : `${s.duplicates} words were`} already in your deck ·{' '}
          <Link className="font-medium underline" to="/words?status=duplicate">
            View
          </Link>
        </p>
      )}

      <section className={`${card} grid grid-cols-3 gap-2 text-center`} aria-label="Deck stats" aria-busy={stats.isPending}>
        <Stat label="Words" value={s?.total} />
        <Stat label="Due now" value={s?.dueNow} />
        <Stat label="New" value={s?.new} />
        <Stat label="Learning" value={s?.learning} />
        <Stat label="Preparing" value={s?.pending} />
        <Stat label="Failed" value={s?.failed} />
      </section>

      <Link to="/train" className={btnPrimary}>
        Train · {s?.dueNow ?? '–'} due
      </Link>
      {s && (s.reviewedToday > 0 || s.dueToday > s.dueNow) && (
        <p className={`${muted} text-center`}>
          {s.reviewedToday} reviewed today{s.dueToday > s.dueNow ? ` · ${s.dueToday - s.dueNow} more due later today` : ''}
        </p>
      )}
      <Link to="/add" className={btnSecondary}>
        Add words
      </Link>
    </Screen>
  )
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex flex-col py-1">
      <span className="text-2xl font-semibold tabular-nums">{value ?? '–'}</span>
      <span className={muted}>{label}</span>
    </div>
  )
}
