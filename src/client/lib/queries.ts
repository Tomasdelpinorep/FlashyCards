/** TanStack Query hooks for every API call the client makes. */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  MeResponse,
  RetryFailedResponse,
  ReviewQueueResponse,
  UpdateMeInput,
  UserDTO,
} from '../../shared/schemas'
import { api, unwrap } from './api'

export type CardStatusFilter = 'pending' | 'ready' | 'failed' | 'suspended' | 'duplicate'

export const keys = {
  me: ['me'] as const,
  languages: ['languages'] as const,
  stats: (deckId: string) => ['decks', deckId, 'stats'] as const,
  cards: (deckId: string, status?: string, q?: string) => ['decks', deckId, 'cards', status ?? 'all', q ?? ''] as const,
  deck: (deckId: string) => ['decks', deckId] as const,
  card: (cardId: string) => ['cards', cardId] as const,
  review: (deckId: string, ahead: boolean) => ['decks', deckId, 'review', ahead ? 1 : 0] as const,
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
    mutationFn: (body: UpdateMeInput) => unwrap<{ user: UserDTO }>(api.me.$patch({ json: body })),
    onSuccess: ({ user }) => qc.setQueryData<MeResponse>(keys.me, (old) => (old ? { ...old, user } : old)),
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
