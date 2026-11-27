import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { CardDTO } from '../../shared/schemas'
import { NoDecks } from '../components/NoDecks'
import { btnSecondary, btnSmall, ErrorText, input, muted, Screen, Word } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useCards, useDeleteCard, type CardStatusFilter } from '../lib/queries'
import { messages, useT, useUiLang } from '../lib/i18n'
import { badgeBase, STATUS_BADGE, statusLabel, wordRowText } from '../lib/wordRow'

const M = messages(
  {
    title: 'Words',
    addWords: 'Add words',
    search: 'Search',
    searchWords: 'Search words',
    filter: 'Filter by status',
    all: 'All',
    pending: 'Preparing',
    ready: 'Ready',
    failed: 'Needs meaning',
    suspended: 'Suspended',
    duplicate: 'Duplicates',
    loading: 'Loading…',
    noMatch: 'No words match.',
    noWords: 'No words yet. Add some!',
    confirmDelete: (word: string) => `Delete “${word}”?`,
    loadMore: 'Load more',
    delete: 'Delete',
    deleteWord: (word: string) => `Delete ${word}`,
  },
  {
    title: 'Palabras',
    addWords: 'Añadir palabras',
    search: 'Buscar',
    searchWords: 'Buscar palabras',
    filter: 'Filtrar por estado',
    all: 'Todas',
    pending: 'Preparando',
    ready: 'Listas',
    failed: 'Falta el significado',
    suspended: 'Suspendidas',
    duplicate: 'Duplicadas',
    loading: 'Cargando…',
    noMatch: 'Ninguna palabra coincide.',
    noWords: 'Todavía no hay palabras. ¡Añade algunas!',
    confirmDelete: (word) => `¿Eliminar “${word}”?`,
    loadMore: 'Cargar más',
    delete: 'Eliminar',
    deleteWord: (word) => `Eliminar ${word}`,
  },
)

const FILTERS: { value: CardStatusFilter | ''; key: 'all' | CardStatusFilter }[] = [
  { value: '', key: 'all' },
  { value: 'pending', key: 'pending' },
  { value: 'ready', key: 'ready' },
  { value: 'failed', key: 'failed' },
  { value: 'suspended', key: 'suspended' },
  { value: 'duplicate', key: 'duplicate' },
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
  const t = useT(M)
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
      <Screen title={t.title}>
        <NoDecks />
      </Screen>
    )
  }

  const list = cards.data?.pages.flatMap((p) => p.cards) ?? []
  return (
    <Screen
      title={t.title}
      action={
        <Link to="/add" className={btnSmall}>
          {t.addWords}
        </Link>
      }
    >
      <input
        type="search"
        className={input}
        placeholder={t.search}
        aria-label={t.searchWords}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setParam('q', e.target.value.trim())
        }}
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label={t.filter}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={(status ?? '') === f.value}
            onClick={() => setParam('status', f.value)}
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-medium ${
              (status ?? '') === f.value
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400'
            }`}
          >
            {t[f.key]}
          </button>
        ))}
      </div>

      <ErrorText error={cards.error ?? remove.error} />
      {cards.isPending && <p className={muted}>{t.loading}</p>}
      {cards.isSuccess && list.length === 0 && (
        <p className={`${muted} py-8 text-center`}>{debouncedQ || status ? t.noMatch : t.noWords}</p>
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
              if (confirm(t.confirmDelete(c.display))) remove.mutate(c.id)
            }}
          />
        ))}
      </ul>

      {cards.hasNextPage && (
        <button type="button" className={btnSecondary} disabled={cards.isFetchingNextPage} onClick={() => void cards.fetchNextPage()}>
          {cards.isFetchingNextPage ? t.loading : t.loadMore}
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
  const t = useT(M)
  const ui = useUiLang()
  const { title, hint, subtitle } = wordRowText(card, ui)
  const badge = STATUS_BADGE[card.status]
  return (
    <li
      ref={highlighted ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
      className={`flex items-center gap-3 py-3 ${highlighted ? '-mx-2 rounded-xl bg-amber-50 px-2 dark:bg-amber-950' : ''}`}
    >
      <Link to={`/words/${card.id}`} className="min-w-0 flex-1">
        <p className="font-medium break-words">
          <Word text={title} lang={lang} />
          {hint && <span className="font-normal text-zinc-500 dark:text-zinc-400"> · {hint}</span>}
        </p>
        <p className={`truncate ${muted} ${card.status === 'failed' ? 'text-red-700 dark:text-red-400' : ''}`}>{subtitle}</p>
      </Link>
      <span className={`${badgeBase} shrink-0 whitespace-nowrap ${badge.className}`} data-testid="status-badge">
        {statusLabel(card.status, ui)}
      </span>
      {card.status !== 'duplicate' && (
        <button type="button" className={`${btnSmall} shrink-0`} onClick={onDelete} disabled={deleting} aria-label={t.deleteWord(card.display)}>
          {deleting ? '…' : t.delete}
        </button>
      )}
    </li>
  )
}
