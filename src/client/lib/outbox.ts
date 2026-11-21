/**
 * Review outbox (PLAN.md section 6): reviews are optimistic. Each one is stored here, keyed by
 * its review UUID, then posted in the background. Entries leave only when the server
 * acknowledges them (2xx, including an idempotent repeat) or rejects them for good (4xx other
 * than 401/403/408/429: the card was deleted, suspended, ...). Anything else (offline, 5xx,
 * an expired Access session) is retried later: on load, when the browser comes back online,
 * after each new review, and on a timer while entries remain.
 *
 * Posts go out one at a time in insertion order, so two reviews of one card (a learning step
 * repeated in the same session) reach the server in the order they were made.
 *
 * The core (`createOutbox`) takes its storage and transport as arguments, so it is unit-tested
 * without a browser. Every storage access is wrapped in try/catch: without storage (private
 * mode, quota) the outbox keeps working in memory for the page's lifetime.
 */
import type { ReviewInput } from '../../shared/schemas'

/** The subset of Web Storage the outbox uses. */
export type KeyValueStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** What happened to one post. */
export type SendResult = 'ack' | 'retry' | 'drop'

export type OutboxEntry = { review: ReviewInput; attempts: number; lastError?: string }

export type Outbox = {
  /** Store a review (replacing an entry with the same id) and return immediately. */
  enqueue(review: ReviewInput): void
  /** Post pending entries in order; stops at the first one that must be retried. */
  flush(): Promise<{ sent: number; dropped: number; remaining: number }>
  /** Pending entries, oldest first. */
  pending(): OutboxEntry[]
}

export const OUTBOX_KEY = 'flashcards.outbox.v1'

export function createOutbox(opts: {
  storage: KeyValueStorage | null
  send: (review: ReviewInput) => Promise<SendResult>
  key?: string
  onChange?: (pending: number) => void
}): Outbox {
  const key = opts.key ?? OUTBOX_KEY
  // Insertion-ordered map: review id -> entry. Memory is the fallback when storage fails.
  let memory = new Map<string, OutboxEntry>()

  function load(): Map<string, OutboxEntry> {
    try {
      const raw = opts.storage?.getItem(key)
      if (raw == null) return memory
      const parsed: unknown = JSON.parse(raw)
      const map = new Map<string, OutboxEntry>()
      if (Array.isArray(parsed)) {
        for (const e of parsed as OutboxEntry[]) {
          if (e && typeof e === 'object' && e.review && typeof e.review.id === 'string') map.set(e.review.id, e)
        }
      }
      memory = map
      return map
    } catch {
      return memory
    }
  }

  function save(map: Map<string, OutboxEntry>) {
    memory = map
    try {
      opts.storage?.setItem(key, JSON.stringify([...map.values()]))
    } catch {
      // Storage full or unavailable: the in-memory copy still gets retried this session.
    }
    opts.onChange?.(map.size)
  }

  let inFlight: Promise<{ sent: number; dropped: number; remaining: number }> | null = null

  async function drain() {
    let sent = 0
    let dropped = 0
    // Re-read storage before each post: another tab may have sent or added entries.
    for (;;) {
      const map = load()
      const next = map.values().next()
      if (next.done) break
      const entry = next.value
      let result: SendResult
      try {
        result = await opts.send(entry.review)
      } catch (err) {
        result = 'retry'
        entry.lastError = err instanceof Error ? err.message : String(err)
      }
      const now = load()
      if (result === 'retry') {
        const cur = now.get(entry.review.id)
        if (cur) {
          cur.attempts += 1
          if (entry.lastError) cur.lastError = entry.lastError
          save(now)
        }
        break
      }
      now.delete(entry.review.id)
      save(now)
      if (result === 'ack') sent++
      else dropped++
    }
    return { sent, dropped, remaining: load().size }
  }

  return {
    enqueue(review) {
      const map = load()
      if (!map.has(review.id)) map.set(review.id, { review, attempts: 0 })
      save(map)
    },
    flush() {
      // One drain at a time: a flush during a flush joins the running one.
      if (!inFlight) inFlight = drain().finally(() => (inFlight = null))
      return inFlight
    },
    pending() {
      return [...load().values()]
    },
  }
}

/** Map an HTTP status of POST /reviews to what the outbox does with the entry. */
export function classifyStatus(status: number): SendResult {
  if (status >= 200 && status < 300) return 'ack'
  if (status === 401 || status === 403 || status === 408 || status === 429) return 'retry'
  if (status >= 400 && status < 500) return 'drop'
  return 'retry'
}

// ---------- browser binding ----------

const RETRY_INTERVAL_MS = 30_000

type BrowserGlobals = {
  localStorage?: KeyValueStorage
  addEventListener?: (type: string, fn: () => void) => void
  fetch: typeof fetch
}

let browserOutbox: Outbox | null = null

function browserStorage(g: BrowserGlobals): KeyValueStorage | null {
  try {
    return g.localStorage ?? null
  } catch {
    return null // accessing localStorage itself can throw (blocked site data)
  }
}

/**
 * The page's outbox (created once): posts with fetch, drains on creation, on `online`, on tab
 * focus and every 30 s while entries remain.
 */
export function getOutbox(): Outbox {
  if (browserOutbox) return browserOutbox
  const g = globalThis as unknown as BrowserGlobals
  let timer: ReturnType<typeof setTimeout> | null = null
  const outbox = createOutbox({
    storage: browserStorage(g),
    send: async (review) => {
      const res = await g.fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(review), // same-origin: the Access cookie is sent by default
      })
      return classifyStatus(res.status)
    },
    onChange: (n) => {
      if (n > 0 && !timer) {
        timer = setTimeout(() => {
          timer = null
          void outbox.flush()
        }, RETRY_INTERVAL_MS)
      }
    },
  })
  browserOutbox = outbox
  g.addEventListener?.('online', () => void outbox.flush())
  g.addEventListener?.('focus', () => void outbox.flush())
  void outbox.flush()
  return outbox
}
