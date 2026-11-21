import { describe, expect, it } from 'vitest'
import { classifyStatus, createOutbox, OUTBOX_KEY, type KeyValueStorage, type SendResult } from '../../src/client/lib/outbox'
import type { ReviewInput } from '../../src/shared/schemas'

class FakeStorage implements KeyValueStorage {
  data = new Map<string, string>()
  failReads = false
  failWrites = false
  getItem(key: string) {
    if (this.failReads) throw new Error('SecurityError')
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError')
    this.data.set(key, value)
  }
}

let n = 0
const review = (cardId = 'card-1'): ReviewInput => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  cardId,
  rating: 3,
  direction: 'target-source',
  reviewedAt: 1_000 + n,
})

/** A transport that answers from a script and records what it was sent. */
function transport(script: SendResult[] = []) {
  const sent: string[] = []
  return {
    sent,
    send: async (r: ReviewInput): Promise<SendResult> => {
      sent.push(r.id)
      return script.shift() ?? 'ack'
    },
  }
}

describe('review outbox', () => {
  it('persists entries keyed by review id and removes them once acknowledged', async () => {
    const storage = new FakeStorage()
    const t = transport()
    const box = createOutbox({ storage, send: t.send })
    const a = review()
    box.enqueue(a)
    box.enqueue(a) // same id: stored once
    expect(JSON.parse(storage.data.get(OUTBOX_KEY)!)).toEqual([{ review: a, attempts: 0 }])
    expect(await box.flush()).toEqual({ sent: 1, dropped: 0, remaining: 0 })
    expect(t.sent).toEqual([a.id])
    expect(box.pending()).toEqual([])
    expect(JSON.parse(storage.data.get(OUTBOX_KEY)!)).toEqual([])
  })

  it('sends in order and stops at the first retry, keeping it and everything after it', async () => {
    const storage = new FakeStorage()
    const t = transport(['ack', 'retry'])
    const box = createOutbox({ storage, send: t.send })
    const [a, b, c] = [review(), review(), review()]
    for (const r of [a, b, c]) box.enqueue(r)
    expect(await box.flush()).toEqual({ sent: 1, dropped: 0, remaining: 2 })
    expect(t.sent).toEqual([a.id, b.id])
    expect(box.pending().map((e) => [e.review.id, e.attempts])).toEqual([
      [b.id, 1],
      [c.id, 0],
    ])
    // Next flush (back online) drains the rest, in order.
    expect(await box.flush()).toEqual({ sent: 2, dropped: 0, remaining: 0 })
    expect(t.sent).toEqual([a.id, b.id, b.id, c.id])
  })

  it('a network error counts as retry; a permanent rejection is dropped', async () => {
    const storage = new FakeStorage()
    let calls = 0
    const box = createOutbox({
      storage,
      send: async () => {
        calls++
        if (calls === 1) throw new TypeError('Failed to fetch')
        return calls === 2 ? 'drop' : 'ack'
      },
    })
    const [a, b] = [review(), review()]
    box.enqueue(a)
    box.enqueue(b)
    expect(await box.flush()).toEqual({ sent: 0, dropped: 0, remaining: 2 })
    expect(box.pending()[0]).toMatchObject({ attempts: 1, lastError: 'Failed to fetch' })
    expect(await box.flush()).toEqual({ sent: 1, dropped: 1, remaining: 0 })
  })

  it('drains entries left by an earlier page load (same storage)', async () => {
    const storage = new FakeStorage()
    const first = createOutbox({ storage, send: async () => 'retry' })
    const a = review()
    first.enqueue(a)
    await first.flush()
    const t = transport()
    const reloaded = createOutbox({ storage, send: t.send })
    expect(reloaded.pending().map((e) => e.review.id)).toEqual([a.id])
    expect(await reloaded.flush()).toMatchObject({ sent: 1, remaining: 0 })
    expect(t.sent).toEqual([a.id])
  })

  it('concurrent flushes share one drain: each entry is sent once', async () => {
    const t = transport()
    const box = createOutbox({ storage: new FakeStorage(), send: t.send })
    box.enqueue(review())
    box.enqueue(review())
    const [x, y] = await Promise.all([box.flush(), box.flush()])
    expect(x).toBe(y)
    expect(t.sent).toHaveLength(2)
  })

  it('keeps working in memory when storage throws or is missing', async () => {
    for (const storage of [Object.assign(new FakeStorage(), { failReads: true, failWrites: true }), null]) {
      const t = transport(['retry'])
      const box = createOutbox({ storage, send: t.send })
      const a = review()
      box.enqueue(a)
      expect(box.pending().map((e) => e.review.id)).toEqual([a.id])
      expect(await box.flush()).toMatchObject({ remaining: 1 })
      expect(await box.flush()).toMatchObject({ sent: 1, remaining: 0 })
    }
  })

  it('ignores corrupt stored data', async () => {
    const storage = new FakeStorage()
    storage.data.set(OUTBOX_KEY, '{not json')
    const box = createOutbox({ storage, send: transport().send })
    expect(box.pending()).toEqual([])
    storage.data.set(OUTBOX_KEY, JSON.stringify([{ nope: 1 }, null]))
    expect(box.pending()).toEqual([])
  })

  it('classifies HTTP statuses', () => {
    expect(classifyStatus(200)).toBe('ack')
    for (const s of [400, 404, 409]) expect(classifyStatus(s)).toBe('drop')
    for (const s of [401, 403, 408, 429, 500, 503]) expect(classifyStatus(s)).toBe('retry')
  })
})
