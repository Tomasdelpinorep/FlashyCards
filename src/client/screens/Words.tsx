import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { CardDTO } from '../../shared/schemas'
import { NoDecks } from '../components/NoDecks'
import { btnSecondary, btnSmall, ErrorText, input, muted, Screen, Word } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useCards, useDeleteCard, type CardStatusFilter } from '../lib/queries'

const FILTERS: { value: CardStatusFilter | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'failed', label: 'Failed' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'duplicate', label: 'Duplicates' },
]

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function Words() {
  const { deck } = useCurrentDeck()
  const [params, setParams] = useSearchParams()
  const status = (FILTERS.find((f) => f.value === params.get('status'))?.value || undefined) as CardStatusFilter | undefined
  const highlight = params.get('card')
  const [q, setQ] = useState(params.get('q') ?? '')
  const debouncedQ = useDebounced(q.trim(), 250)
  const cards = useCards(deck?.id, status, debouncedQ)
  const remove = useDeleteCard(deck?.id ?? '')

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('card')
    setParams(next, { replace: true })
  }

  if (!deck) {
    return (
      <Screen title="Words">
        <NoDecks />
      </Screen>
    )
  }

  const list = cards.data?.pages.flatMap((p) => p.cards) ?? []
  return (
    <Screen
      title="Words"
      action={
        <Link to="/add" className={btnSmall}>
          Add words
        </Link>
      }
    >
      <input
        type="search"
        className={input}
        placeholder="Search"
        aria-label="Search words"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setParam('q', e.target.value.trim())
        }}
      />
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={(status ?? '') === f.value}
            onClick={() => setParam('status', f.value)}
            className={`h-8 shrink-0 rounded-full px-3 text-sm font-medium ${
              (status ?? '') === f.value
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ErrorText error={cards.error ?? remove.error} />
      {cards.isPending && <p className={muted}>Loading…</p>}
      {cards.isSuccess && list.length === 0 && (
        <p className={`${muted} py-8 text-center`}>{debouncedQ || status ? 'No words match.' : 'No words yet. Add some!'}</p>
      )}

      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {list.map((c) => (
          <CardRow
            key={c.id}
            card={c}
            lang={deck.targetLang}
            highlighted={c.id === highlight}
            deleting={remove.isPending && remove.variables === c.id}
            onDelete={() => {
              if (confirm(`Delete “${c.display}”?`)) remove.mutate(c.id)
            }}
          />
        ))}
      </ul>

      {cards.hasNextPage && (
        <button type="button" className={btnSecondary} disabled={cards.isFetchingNextPage} onClick={() => void cards.fetchNextPage()}>
          {cards.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </Screen>
  )
}

function CardRow({
  card,
  lang,
  highlighted,
  deleting,
  onDelete,
}: {
  card: CardDTO
  lang: string
  highlighted: boolean
  deleting: boolean
  onDelete: () => void
}) {
  const subtitle =
    card.status === 'pending'
      ? 'Preparing…'
      : card.status === 'duplicate'
        ? `Already in your deck${card.duplicateOf ? ` as ${card.duplicateOf.display}` : ''}`
        : card.status === 'failed'
          ? 'Generation failed'
          : [card.translation, ...card.extraTranslations].filter(Boolean).join(', ') || card.inputHint || ''
  return (
    <li
      ref={highlighted ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
      className={`flex items-center gap-3 py-3 ${highlighted ? '-mx-2 rounded-xl bg-amber-50 px-2 dark:bg-amber-950' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          <Word text={card.display} lang={lang} />
          {card.inputHint && card.status === 'pending' && <span className="font-normal text-zinc-500 dark:text-zinc-400"> · {card.inputHint}</span>}
        </p>
        <p className={`truncate ${muted} ${card.status === 'failed' ? 'text-red-700 dark:text-red-400' : ''}`}>{subtitle}</p>
      </div>
      {card.status !== 'duplicate' && (
        <button type="button" className={`${btnSmall} shrink-0`} onClick={onDelete} disabled={deleting} aria-label={`Delete ${card.display}`}>
          {deleting ? '…' : 'Delete'}
        </button>
      )}
    </li>
  )
}
