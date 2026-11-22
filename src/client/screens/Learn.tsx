/**
 * Learn new (PLAN.md section 6, DUPLICATES.md 10.8/10.9 M6): ready New cards in groups of 5.
 * Each card first gets an intro (both sides, "Also in your deck", Listen). "Got it" sends it to
 * the quick check; "I already know this" rates it Easy and it leaves the session. The quick check
 * works like Train (flip, 4 grades with interval labels, Space / 1-4) in the user's saved
 * direction, and requeues learning steps until they graduate (lib/learnSession.ts on top of
 * lib/session.ts). Reviews go through the outbox; a reload resumes from the server's state.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { cardFaces, introFaces, pickDirection, type FaceDirection } from '../../shared/display'
import { isLanguageCode, LANGUAGES } from '../../shared/languages'
import { LEARN_EXTRA_MAX, type LearnQueueResponse, type ReviewInput } from '../../shared/schemas'
import { loadSrs, previewIntervals, type Grade, type Srs } from '../../shared/srs'
import { NoDecks } from '../components/NoDecks'
import { CardBack, CardFront, GradeButtons } from '../components/StudyCard'
import { btnPrimary, btnSecondary, card as cardClass, ErrorText, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import {
  alreadyKnow,
  clearResume,
  gotIt,
  gradeCheck,
  LEARN_MORE_STEP,
  learnStep,
  loadResume,
  remainingCount,
  resumeLearn,
  saveResume,
  tick,
  type LearnSession,
} from '../lib/learnSession'
import { getOutbox } from '../lib/outbox'
import { enqueueReview, fetchReviewQueue, keys, useDeckStats, useLearnQueue, useMe } from '../lib/queries'
import { speak, stopSpeaking } from '../lib/tts'

const TICK_MS = 15_000

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function parseExtra(v: string | null): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? Math.min(n, LEARN_EXTRA_MAX) : undefined
}

export function Learn() {
  const { deck } = useCurrentDeck()
  const me = useMe()
  const qc = useQueryClient()
  const settings = me.data?.user.settings
  const [params, setParams] = useSearchParams()
  const extra = parseExtra(params.get('extra'))
  const query = useLearnQueue(deck?.id, extra)
  const stats = useDeckStats(deck?.id)
  const [srs, setSrs] = useState<Srs | null>(null)
  const [srsError, setSrsError] = useState<unknown>(null)
  const [session, setSession] = useState<LearnSession | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [flipped, setFlipped] = useState(false)
  // Direction and start time of the card on screen, fixed when it appears (Mixed picks at random).
  const shown = useRef<{ key: string; direction: FaceDirection; at: number } | null>(null)

  useEffect(() => {
    let alive = true
    loadSrs().then(
      (s) => alive && setSrs(s),
      (e: unknown) => alive && setSrsError(e),
    )
    return () => {
      alive = false
    }
  }, [])

  // A fresh /learn page starts (or resumes) a session. The outbox drained before the fetch, so
  // the server already has every earlier grade; cards left mid-step come back from /review.
  useEffect(() => {
    const data = query.data
    if (!data || !deck) return
    let alive = true
    const resume = loadResume(sessionStore(), deck.id, Date.now())
    const pendingIds = new Set(getOutbox().pending().map((e) => e.review.cardId))
    // With ?extra=N, a resumed session only tops up to N new cards in all.
    const consumed = resume ? resume.learned.length + resume.alreadyKnew : 0
    const learnCards = extra ? data.cards.slice(0, Math.max(0, extra - consumed)) : data.cards
    const start = (reviewCards: LearnQueueResponse['cards']) => {
      if (!alive) return
      setSession(resumeLearn(learnCards, reviewCards, resume, pendingIds, Date.now()))
      setFlipped(false)
      setNow(Date.now())
    }
    if (resume && resume.touched.length > 0) {
      fetchReviewQueue(deck.id).then(
        (r) => start(r.cards),
        () => start([]),
      )
    } else start([])
    return () => {
      alive = false
    }
    // Once per fetched page: deck and extra are part of the query key.
  }, [query.data])

  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      setSession((s) => (s ? tick(s, n) : s))
    }, TICK_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => stopSpeaking, [])

  const step = session ? learnStep(session, now) : null
  const stepKey = step && step.kind !== 'done' && session ? `${step.kind}:${step.card.id}:${session.check.reviewed}` : null
  if (step && step.kind !== 'done' && stepKey && shown.current?.key !== stepKey) {
    shown.current = { key: stepKey, direction: pickDirection(settings?.studyDirection ?? 'target-source'), at: Date.now() }
  }
  const direction = shown.current?.direction ?? 'target-source'
  const done = step?.kind === 'done'

  // Remember the session for a reload; forget it once the summary shows.
  useEffect(() => {
    if (!session || !deck) return
    if (done) clearResume(sessionStore())
    else saveResume(sessionStore(), deck.id, session, Date.now())
  }, [session, deck, done])

  useEffect(() => {
    if (done && deck) void qc.invalidateQueries({ queryKey: keys.stats(deck.id) })
  }, [done, deck, qc])

  const targetLang = deck?.targetLang ?? ''
  const ttsLang = isLanguageCode(targetLang) ? LANGUAGES[targetLang].ttsLang : targetLang

  const introCard = step?.kind === 'intro' ? step.card : null
  const intro = useMemo(() => (introCard ? introFaces(introCard) : null), [introCard])
  const checkCard = step?.kind === 'check' ? step.card : null
  const faces = useMemo(
    () => (checkCard ? cardFaces(checkCard, direction, { hideSentenceOnFront: settings?.hideSentenceOnFront }) : null),
    [checkCard, direction, settings?.hideSentenceOnFront],
  )
  const labels = useMemo(() => (checkCard && srs ? previewIntervals(srs, checkCard.id, checkCard.srs, Date.now()) : null), [checkCard, srs])

  // Autoplay the word when an intro card appears (once per card).
  const autoplayed = useRef<string | null>(null)
  useEffect(() => {
    if (!introCard || !intro || autoplayed.current === introCard.id) return
    autoplayed.current = introCard.id
    if (settings?.ttsAutoplay) speak([intro.speech.word], ttsLang)
  }, [introCard, intro, settings?.ttsAutoplay, ttsLang])

  const record = useCallback(
    (cardId: string, rating: Grade, dir: FaceDirection) => {
      if (!deck) return Date.now()
      const reviewedAt = Date.now()
      const review: ReviewInput = {
        id: crypto.randomUUID(),
        cardId,
        rating,
        direction: dir,
        reviewedAt,
        durationMs: Math.min(86_400_000, Math.max(0, reviewedAt - (shown.current?.at ?? reviewedAt))),
      }
      enqueueReview(qc, deck.id, review)
      return reviewedAt
    },
    [deck, qc],
  )

  const onGotIt = useCallback(() => {
    if (!session || step?.kind !== 'intro') return
    stopSpeaking()
    const t = Date.now()
    setSession(gotIt(session, step.card.id, t))
    setNow(t)
  }, [session, step])

  const onAlreadyKnow = useCallback(() => {
    if (!session || step?.kind !== 'intro') return
    stopSpeaking()
    // Easy, as if the German side had been shown (target -> source).
    const t = record(step.card.id, 4, 'target-source')
    setSession(alreadyKnow(session, step.card.id, t))
    setNow(t)
  }, [session, step, record])

  const flip = useCallback(() => {
    if (!faces || flipped) return
    setFlipped(true)
    if (settings?.ttsAutoplay) speak([faces.speech.word], ttsLang)
  }, [faces, flipped, settings?.ttsAutoplay, ttsLang])

  const grade = useCallback(
    (g: Grade) => {
      if (!checkCard || !session || !srs || !flipped) return
      const t = record(checkCard.id, g, direction)
      const { after } = srs.review(checkCard.id, checkCard.srs, g, t)
      stopSpeaking()
      setSession(gradeCheck(session, checkCard, g, after, t))
      setFlipped(false)
      setNow(t)
    },
    [checkCard, session, srs, flipped, record, direction],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shortcuts are for the quick check only; the intro has two plain buttons.
      if (step?.kind !== 'check') return
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        flip()
      } else if (/^[1-4]$/.test(e.key)) grade(Number(e.key) as Grade)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step?.kind, flip, grade])

  const learnMore = () => {
    clearResume(sessionStore())
    setSession(null)
    if (extra === LEARN_MORE_STEP) void query.refetch()
    else setParams({ extra: String(LEARN_MORE_STEP) })
  }

  if (!deck) {
    return (
      <Screen title="Learn">
        <NoDecks />
      </Screen>
    )
  }

  const studied = session ? session.learned.length + session.alreadyKnew : 0
  const left = session ? remainingCount(session) : 0

  return (
    <Screen
      title="Learn"
      action={
        <Link to="/" className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm font-medium text-zinc-500 underline dark:text-zinc-400">
          Done
        </Link>
      }
    >
      <ErrorText error={query.error ?? srsError ?? me.error} />
      {(query.isPending || !session) && !query.error && <p className={muted}>Loading…</p>}

      {session && step?.kind === 'intro' && intro && (
        <>
          <p className={`${muted} text-center`}>New word</p>
          <section className={`${cardClass} flex min-h-72 flex-col justify-center gap-4 text-center`} aria-live="polite">
            <CardBack back={intro} lang={targetLang} onSpeak={() => speak([intro.speech.word, intro.speech.sentence], ttsLang)} />
          </section>
          <button type="button" className={btnPrimary} onClick={onGotIt}>
            Got it
          </button>
          <button type="button" className={btnSecondary} onClick={onAlreadyKnow}>
            I already know this
          </button>
        </>
      )}

      {session && step?.kind === 'check' && faces && (
        <>
          <p className={`${muted} text-center`}>Quick check</p>
          <section
            className={`${cardClass} flex min-h-72 cursor-pointer flex-col justify-center gap-4 text-center select-none`}
            onClick={flip}
            aria-live="polite"
          >
            {!flipped ? (
              <CardFront faces={faces} lang={targetLang} />
            ) : (
              <CardBack back={faces.back} lang={targetLang} onSpeak={() => speak([faces.speech.word, faces.speech.sentence], ttsLang)} />
            )}
          </section>
          {!flipped ? (
            <button type="button" className={btnPrimary} onClick={flip}>
              Show answer <span className="ml-2 text-xs opacity-60">Space</span>
            </button>
          ) : (
            <GradeButtons labels={labels} disabled={!srs} onGrade={grade} />
          )}
        </>
      )}

      {session && step && step.kind !== 'done' && (
        <p className={`${muted} text-center`}>
          {left} left{studied > 0 ? ` · ${session.learned.length} learned` : ''}
          {session.alreadyKnew > 0 ? ` · ${session.alreadyKnew} already known` : ''}
        </p>
      )}

      {session && done && studied > 0 && (
        <section className={`${cardClass} flex flex-col gap-3 text-center`} role="status">
          <p className="text-xl font-semibold">Nice work</p>
          <p>
            {session.learned.length} {session.learned.length === 1 ? 'word' : 'words'} learned
            {session.alreadyKnew > 0 ? ` · ${session.alreadyKnew} already known` : ''}
          </p>
          <p className={muted}>They'll come back in Train when they're due.</p>
          <Link to="/train" className={btnPrimary}>
            Train now
          </Link>
          <Link to="/" className={btnSecondary}>
            Home
          </Link>
        </section>
      )}

      {session && done && studied === 0 && query.data && (
        <Empty info={query.data} pending={stats.data?.pending ?? 0} onLearnMore={learnMore} />
      )}
    </Screen>
  )
}

function Empty({ info, pending, onLearnMore }: { info: LearnQueueResponse; pending: number; onLearnMore: () => void }) {
  if (info.readyNewTotal === 0 || info.remainingToday > 0) {
    return (
      <section className={`${cardClass} flex flex-col gap-3 text-center`}>
        <p className="text-xl font-semibold">{info.readyNewTotal === 0 ? 'No new words ready' : 'Nothing new to learn right now'}</p>
        {pending > 0 && <p className={muted}>{pending === 1 ? '1 word is' : `${pending} words are`} still being prepared.</p>}
        <Link to="/add" className={btnPrimary}>
          Add words
        </Link>
        <Link to="/" className={btnSecondary}>
          Home
        </Link>
      </section>
    )
  }
  return (
    <section className={`${cardClass} flex flex-col gap-3 text-center`}>
      <p className="text-xl font-semibold">Daily limit reached</p>
      <p className={muted}>
        {info.newToday} new {info.newToday === 1 ? 'word' : 'words'} today · {info.readyNewTotal} ready
      </p>
      <button type="button" className={btnPrimary} onClick={onLearnMore}>
        Learn {LEARN_MORE_STEP} more
      </button>
      <Link to="/train" className={btnSecondary}>
        Train instead
      </Link>
    </section>
  )
}
