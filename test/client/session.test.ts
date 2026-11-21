import { describe, expect, it } from 'vitest'
import { currentCard, gradeCard, nextAgainAt, startSession } from '../../src/client/lib/session'
import type { CardDTO } from '../../src/shared/schemas'
import { CardState, loadSrs, newSrsFields, type SrsFields } from '../../src/shared/srs'

const NOW = Date.UTC(2026, 10, 21, 12)
const DAY = 86_400_000

function card(id: string, srs: SrsFields): CardDTO {
  return {
    id,
    deckId: 'd',
    status: 'ready',
    display: id,
    inputTerm: id,
    inputHint: null,
    inputLang: 'target',
    translation: null,
    extraTranslations: [],
    content: null,
    genError: null,
    state: srs.state,
    due: srs.due,
    srs,
    createdAt: 0,
  }
}

const reviewSrs = (due: number): SrsFields => ({
  ...newSrsFields(due),
  state: CardState.Review,
  stability: 10,
  difficulty: 5,
  reps: 4,
  scheduled_days: 10,
  last_review: due - 10 * DAY,
})

describe('Train session queue', () => {
  it('a lapsed card comes back in the session once its relearning step is due; a passed card does not', async () => {
    const srs = await loadSrs()
    let s = startSession([card('a', reviewSrs(NOW)), card('b', reviewSrs(NOW))])
    expect(currentCard(s, NOW)?.id).toBe('a')

    const again = srs.review('a', reviewSrs(NOW), 1, NOW).after // relearning, +10 min
    s = gradeCard(s, currentCard(s, NOW)!, 1, again, NOW)
    expect(s).toMatchObject({ reviewed: 1, correct: 0 })
    expect(s.again.map((c) => [c.id, c.srs.state])).toEqual([['a', CardState.Relearning]])
    expect(currentCard(s, NOW)?.id).toBe('b') // a is not due yet

    const good = srs.review('b', reviewSrs(NOW), 3, NOW).after // days away
    s = gradeCard(s, currentCard(s, NOW)!, 3, good, NOW)
    expect(s.again.map((c) => c.id)).toEqual(['a'])
    // Nothing else left: the requeued card is shown early (within the 20-minute learn-ahead).
    expect(currentCard(s, NOW)?.id).toBe('a')
    expect(nextAgainAt(s)).toBe(NOW + 10 * 60_000)

    const after = srs.review('a', currentCard(s, NOW)!.srs, 3, NOW + 10 * 60_000).after
    s = gradeCard(s, currentCard(s, NOW)!, 3, after, NOW + 10 * 60_000)
    expect(s).toMatchObject({ reviewed: 3, correct: 2 })
    expect(currentCard(s, NOW + 10 * 60_000)).toBeNull()
  })

  it('a requeued card that is due goes before the rest of the queue', () => {
    const due = card('x', { ...newSrsFields(NOW - 1000), state: CardState.Learning })
    const s = { ...startSession([card('q', reviewSrs(NOW))]), again: [due] }
    expect(currentCard(s, NOW)?.id).toBe('x')
  })

  it('a requeued card beyond the learn-ahead window ends the session', () => {
    const later = card('x', { ...newSrsFields(NOW + 3_600_000), state: CardState.Learning })
    const s = { ...startSession([]), again: [later] }
    expect(currentCard(s, NOW)).toBeNull()
  })
})
