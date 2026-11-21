import { Hono } from 'hono'
import type { LanguageCode } from '../../shared/languages'
import { MAX_IMPORT_ROWS } from '../../shared/parseImport'
import {
  CardListQuerySchema,
  CreateDeckSchema,
  DEFAULT_DECK_SETTINGS,
  DeckIdParamSchema,
  ImportSchema,
  LearnQuerySchema,
  ReviewQueueQuerySchema,
  StatsQuerySchema,
  SuggestSchema,
  UpdateDeckSchema,
} from '../../shared/schemas'
import { deckStats, learnQueue, listCards, retryFailed, reviewQueue } from '../db/cards'
import { createDeck, deckSettings, deleteDeck, getDeck, toDeckDTO, updateDeck } from '../db/decks'
import type { AppEnv } from '../env'
import { validate } from '../middleware/errors'
import { generateForDeck } from '../services/generation'
import { importCards, TooManyRowsError } from '../services/importer'
import { limitsFrom } from '../services/rateLimit'
import { AiNotConfiguredError, SuggestAiError, SuggestRateLimitedError, suggestForDeck } from '../services/suggest'

// Decks owned by another user are reported as 404 (never 403) so their existence is not revealed.
const notFound = { error: 'not_found', message: 'Deck not found' } as const

export const deckRoutes = new Hono<AppEnv>()
  .post('/', validate('json', CreateDeckSchema), async (c) => {
    const body = c.req.valid('json')
    const row = await createDeck(c.env.DB, c.get('user').id, {
      name: body.name,
      sourceLang: body.sourceLang,
      targetLang: body.targetLang,
      settings: { ...DEFAULT_DECK_SETTINGS, ...body.settings },
    })
    return c.json({ deck: toDeckDTO(row) }, 201)
  })
  .patch('/:id', validate('param', DeckIdParamSchema), validate('json', UpdateDeckSchema), async (c) => {
    const userId = c.get('user').id
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const existing = await getDeck(c.env.DB, userId, id)
    if (!existing) return c.json(notFound, 404)
    const row = await updateDeck(c.env.DB, userId, id, {
      name: body.name,
      settings: body.settings ? { ...deckSettings(existing), ...body.settings } : undefined,
    })
    if (!row) return c.json(notFound, 404)
    return c.json({ deck: toDeckDTO(row) }, 200)
  })
  .delete('/:id', validate('param', DeckIdParamSchema), async (c) => {
    const userId = c.get('user').id
    const { id } = c.req.valid('param')
    // Any deck may be deleted, including the last one: a user may have zero decks.
    if (!(await deleteDeck(c.env.DB, userId, id))) return c.json(notFound, 404)
    return c.json({ ok: true as const }, 200)
  })
  .post('/:id/import', validate('param', DeckIdParamSchema), validate('json', ImportSchema), async (c) => {
    const deck = await getDeck(c.env.DB, c.get('user').id, c.req.valid('param').id)
    if (!deck) return c.json(notFound, 404)
    try {
      return c.json(await importCards(c.env.DB, deck, c.req.valid('json')), 200)
    } catch (err) {
      if (err instanceof TooManyRowsError) {
        return c.json({ error: 'too_many_rows', message: `At most ${MAX_IMPORT_ROWS} rows per import` }, 400)
      }
      throw err
    }
  })
  .post('/:id/suggest', validate('param', DeckIdParamSchema), validate('json', SuggestSchema), async (c) => {
    const user = c.get('user')
    const deck = await getDeck(c.env.DB, user.id, c.req.valid('param').id)
    if (!deck) return c.json(notFound, 404)
    try {
      const result = await suggestForDeck(c.env.DB, deck, c.req.valid('json').count, {
        generator: c.get('generator'),
        limits: limitsFrom(c.env),
        userId: user.id,
      })
      return c.json(result, 200)
    } catch (err) {
      if (err instanceof AiNotConfiguredError) return c.json({ error: 'ai_not_configured', message: "AI isn't configured on the server" }, 503)
      if (err instanceof SuggestRateLimitedError) {
        return c.json({ error: 'rate_limited', message: 'Daily limit for new words reached', limitResetsAt: err.resetsAt }, 429)
      }
      if (err instanceof SuggestAiError) return c.json({ error: 'ai_unavailable', message: "Couldn't get word suggestions right now" }, 503)
      throw err
    }
  })
  .post('/:id/generate', validate('param', DeckIdParamSchema), async (c) => {
    const user = c.get('user')
    const deck = await getDeck(c.env.DB, user.id, c.req.valid('param').id)
    if (!deck) return c.json(notFound, 404)
    // Fail closed before claiming anything: cards stay pending, no attempt is counted.
    const generator = c.get('generator')()
    if (!generator) return c.json({ error: 'ai_not_configured', message: "AI isn't configured on the server" }, 503)
    const result = await generateForDeck(c.env.DB, deck, {
      generator,
      limits: limitsFrom(c.env),
      userId: user.id,
    })
    return c.json(result, 200)
  })
  .post('/:id/retry-failed', validate('param', DeckIdParamSchema), async (c) => {
    const deck = await getDeck(c.env.DB, c.get('user').id, c.req.valid('param').id)
    if (!deck) return c.json(notFound, 404)
    return c.json({ retried: await retryFailed(c.env.DB, deck.id) }, 200)
  })
  .get('/:id/cards', validate('param', DeckIdParamSchema), validate('query', CardListQuerySchema), async (c) => {
    const deck = await getDeck(c.env.DB, c.get('user').id, c.req.valid('param').id)
    if (!deck) return c.json(notFound, 404)
    const page = await listCards(c.env.DB, deck.id, deck.target_lang as LanguageCode, c.req.valid('query'))
    if (!page) return c.json({ error: 'invalid_request', message: 'Invalid cursor' }, 400)
    return c.json(page, 200)
  })
  .get('/:id/stats', validate('param', DeckIdParamSchema), validate('query', StatsQuerySchema), async (c) => {
    const userId = c.get('user').id
    const deck = await getDeck(c.env.DB, userId, c.req.valid('param').id)
    if (!deck) return c.json(notFound, 404)
    const stats = await deckStats(c.env.DB, deck.id, { userId, tzOffset: c.req.valid('query').tzOffset })
    return c.json({ stats }, 200)
  })
  .get('/:id/learn', validate('param', DeckIdParamSchema), validate('query', LearnQuerySchema), async (c) => {
    const userId = c.get('user').id
    const deck = await getDeck(c.env.DB, userId, c.req.valid('param').id)
    if (!deck) return c.json(notFound, 404)
    const q = c.req.valid('query')
    const queue = await learnQueue(c.env.DB, deck.id, {
      userId,
      dailyNewLimit: deckSettings(deck).dailyNewLimit,
      limit: q.limit,
      extra: q.extra,
      tzOffset: q.tzOffset,
    })
    return c.json(queue, 200)
  })
  .get('/:id/review', validate('param', DeckIdParamSchema), validate('query', ReviewQueueQuerySchema), async (c) => {
    const deck = await getDeck(c.env.DB, c.get('user').id, c.req.valid('param').id)
    if (!deck) return c.json(notFound, 404)
    const q = c.req.valid('query')
    return c.json(await reviewQueue(c.env.DB, deck.id, { limit: q.limit, ahead: q.ahead === '1' }), 200)
  })
