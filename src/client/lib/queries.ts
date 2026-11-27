/** TanStack Query hooks for every API call the client makes. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { LanguageConfig } from '../../shared/languages'
import type {
  CardResponse,
  CardListResponse,
  CreateDeckInput,
  DeckDTO,
  DeckStats,
  GenerateResponse,
  ImportInput,
  ImportResponse,
  LearnQueueResponse,
  MeResponse,
  RetryFailedResponse,
  ReviewInput,
  ReviewQueueResponse,
  SuggestResponse,
  MeaningInput,
  UpdateCardInput,
  UpdateDeckInput,
  UpdateMeInput,
} from '../../shared/schemas'
import { api, unwrap } from './api'
import { getOutbox } from './outbox'

export type CardStatusFilter = 'pending' | 'ready' | 'failed' | 'suspended' | 'duplicate'

export const keys = {
  me: ['me'] as const,
  languages: ['languages'] as const,
  stats: (deckId: string) => ['decks', deckId, 'stats'] as const,
  cards: (deckId: string, status?: string, q?: string) => ['decks', deckId, 'cards', status ?? 'all', q ?? ''] as const,
  deck: (deckId: string) => ['decks', deckId] as const,
  card: (cardId: string) => ['cards', cardId] as const,
  review: (deckId: string, ahead: boolean) => ['decks', deckId, 'review', ahead ? 1 : 0] as const,
  learn: (deckId: string, extra: number) => ['decks', deckId, 'learn', extra] as const,
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => unwrap<MeResponse>(api.me.$get()) })
}

export function useLanguages() {
  return useQuery({
    queryKey: keys.languages,
    queryFn: () => unwrap<{ languages: LanguageConfig[] }>(api.languages.$get()),
    staleTime: Infinity,
  })
}

export function useDeckStats(deckId: string | undefined) {
  return useQuery({
    queryKey: keys.stats(deckId ?? ''),
    queryFn: () =>
      unwrap<{ stats: DeckStats }>(
        // The user's local day for dueToday / reviewedToday / newToday.
        api.decks[':id'].stats.$get({ param: { id: deckId! }, query: { tzOffset: String(new Date().getTimezoneOffset()) } }),
      ),
    enabled: !!deckId,
    select: (d) => d.stats,
  })
}

export function useCards(deckId: string | undefined, status: CardStatusFilter | undefined, q: string) {
  return useInfiniteQuery({
    queryKey: keys.cards(deckId ?? '', status, q),
    enabled: !!deckId,
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      unwrap<CardListResponse>(
        api.decks[':id'].cards.$get({
          param: { id: deckId! },
          query: {
            ...(status ? { status } : {}),
            ...(q ? { q } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
            limit: '50',
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function useImport(deckId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ImportInput) =>
      unwrap<ImportResponse>(api.decks[':id'].import.$post({ param: { id: deckId }, json: body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.deck(deckId) }),
  })
}

/** POST /decks/:id/suggest ("Add new words", M7). */
export function useSuggest(deckId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (count: number) =>
      unwrap<SuggestResponse>(api.decks[':id'].suggest.$post({ param: { id: deckId }, json: { count } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.deck(deckId) }),
  })
}

/** PATCH /decks/:id (name and/or partial settings); refreshes /me, which holds the decks. */
export function useUpdateDeck(deckId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateDeckInput) => unwrap<{ deck: DeckDTO }>(api.decks[':id'].$patch({ param: { id: deckId }, json: body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  })
}

export function useDeleteCard(deckId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) => unwrap<{ ok: true }>(api.cards[':id'].$delete({ param: { id: cardId } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.deck(deckId) }),
  })
}

export function useCreateDeck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateDeckInput) => unwrap<{ deck: DeckDTO }>(api.decks.$post({ json: body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  })
}

export function useDeleteDeck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (deckId: string) => unwrap<{ ok: true }>(api.decks[':id'].$delete({ param: { id: deckId } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  })
}

export function useCard(cardId: string | undefined) {
  return useQuery({
    queryKey: keys.card(cardId ?? ''),
    enabled: !!cardId,
    queryFn: () => unwrap<CardResponse>(api.cards[':id'].$get({ param: { id: cardId! } })),
    select: (d) => d.card,
  })
}

/** PATCH /cards/:id (edit / suspend, M8): refreshes the card, the deck's lists and its stats. */
export function useUpdateCard(deckId: string, cardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateCardInput) => unwrap<CardResponse>(api.cards[':id'].$patch({ param: { id: cardId }, json: body })),
    onSuccess: ({ card }) => {
      qc.setQueryData<CardResponse>(keys.card(cardId), { card })
      void qc.invalidateQueries({ queryKey: keys.card(cardId) })
      void qc.invalidateQueries({ queryKey: keys.deck(deckId) })
    },
  })
}

/** POST /cards/:id/meaning: the user's meaning for a word the dictionary doesn't know. */
export function useFillMeaning(deckId: string, cardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: MeaningInput) => unwrap<CardResponse>(api.cards[':id'].meaning.$post({ param: { id: cardId }, json: body })),
    onSuccess: ({ card }) => {
      qc.setQueryData<CardResponse>(keys.card(cardId), { card })
      void qc.invalidateQueries({ queryKey: keys.card(cardId) })
      void qc.invalidateQueries({ queryKey: keys.deck(deckId) })
    },
  })
}

/** One /generate call (the loop lives in lib/generation.tsx). */
export function generateOnce(deckId: string): Promise<GenerateResponse> {
  return unwrap<GenerateResponse>(api.decks[':id'].generate.$post({ param: { id: deckId } }))
}

export function useRetryFailed(deckId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap<RetryFailedResponse>(api.decks[':id']['retry-failed'].$post({ param: { id: deckId } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.deck(deckId) }),
  })
}

export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateMeInput) => unwrap<MeResponse>(api.me.$patch({ json: body })),
    onSuccess: (data, body) => {
      qc.setQueryData<MeResponse>(keys.me, data)
      // A new app language converts the decks (meanings, examples): refetch everything else.
      if (body.settings?.uiLang) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] })
    },
  })
}

/**
 * The cards to review (GET /decks/:id/review). Fetched once per session: no refetch on focus,
 * since the Train screen keeps its own in-memory queue.
 */
export function useReviewQueue(deckId: string | undefined, ahead: boolean) {
  return useQuery({
    queryKey: keys.review(deckId ?? '', ahead),
    enabled: !!deckId,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () =>
      unwrap<ReviewQueueResponse>(
        api.decks[':id'].review.$get({ param: { id: deckId! }, query: { limit: '50', ...(ahead ? { ahead: '1' as const } : {}) } }),
      ),
  })
}

/**
 * Record a review optimistically (Train and Learn): it goes to the outbox, which posts it in the
 * background; the deck stats refresh once the drain finishes.
 */
export function enqueueReview(qc: QueryClient, deckId: string, review: ReviewInput): void {
  const outbox = getOutbox()
  outbox.enqueue(review)
  void outbox.flush().then(() => qc.invalidateQueries({ queryKey: keys.stats(deckId) }))
}

/**
 * The New cards to learn (GET /decks/:id/learn), fetched once per session like the review queue.
 * Waits for the outbox to drain first so the server, the source of truth, already has every grade
 * made before a reload.
 */
export function useLearnQueue(deckId: string | undefined, extra: number | undefined) {
  return useQuery({
    queryKey: keys.learn(deckId ?? '', extra ?? 0),
    enabled: !!deckId,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      await getOutbox().flush().catch(() => undefined)
      return unwrap<LearnQueueResponse>(
        api.decks[':id'].learn.$get({
          param: { id: deckId! },
          query: { limit: '50', tzOffset: String(new Date().getTimezoneOffset()), ...(extra ? { extra: String(extra) } : {}) },
        }),
      )
    },
  })
}

/** GET /decks/:id/review once, outside a query (Learn's resume after a reload). */
export function fetchReviewQueue(deckId: string): Promise<ReviewQueueResponse> {
  return unwrap<ReviewQueueResponse>(api.decks[':id'].review.$get({ param: { id: deckId }, query: { limit: '100' } }))
}
