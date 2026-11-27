/**
 * Learn new (PLAN.md section 6, DUPLICATES.md 10.8/10.9 M6): ready New cards in groups of 5.
 * Each card first gets a two-step intro (components/LearnIntroCard.tsx): the source word, then
 * the target word with its grammar. Right arrow / Space / swipe left / the arrow button step
 * forward (past the last step = "got it": the card goes to the quick check); Left / swipe right
 * go back a step or to the previous intro card (no SRS writes). "I already know this" rates it
 * Easy and it leaves the session. The quick check works like Train (a typed answer,
 * components/AnswerCard.tsx) in the user's saved direction, and requeues learning steps until they graduate (lib/learnSession.ts on top of
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
import { AnswerCard } from '../components/AnswerCard'
import { LearnIntroCard } from '../components/LearnIntroCard'
import { btnPrimary, btnSecondary, card as cardClass, ErrorText, muted, Screen, studyCard, studyFooter } from '../components/ui'
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
import { messages, useT, useUiLang } from '../lib/i18n'

const words = (n: number) => (n === 1 ? 'word' : 'words')
const palabras = (n: number) => (n === 1 ? 'palabra' : 'palabras')

const M = messages(
  {
    title: 'Learn',
    done: 'Done',
    loading: 'Loading…',
    newWord: 'New word',
    step: (n: number) => `Step ${n} of 2`,
    back: 'Back',
    showWord: 'Show the word',
    gotIt: 'Got it',
    alreadyKnow: 'I already know this',
    quickCheck: 'Quick check',
    left: (n: number) => `${n} left`,
    learned: (n: number) => ` · ${n} learned`,
    alreadyKnown: (n: number) => ` · ${n} already known`,
    niceWork: 'Nice work',
    wordsLearned: (n: number) => `${n} ${words(n)} learned`,
    comeBack: "They'll come back in Train when they're due.",
    trainNow: 'Train now',
    home: 'Home',
    noneReady: 'No new words ready',
    nothingNow: 'Nothing new to learn right now',
    pending: (n: number) => `${n === 1 ? '1 word is' : `${n} words are`} still being prepared.`,
    addWords: 'Add words',
    limit: 'Daily limit reached',
    newToday: (n: number, ready: number) => `${n} new ${words(n)} today · ${ready} ready`,
    learnMore: (n: number) => `Learn ${n} more`,
    trainInstead: 'Train instead',
  },
  {
    title: 'Aprender',
    done: 'Hecho',
    loading: 'Cargando…',
    newWord: 'Palabra nueva',
    step: (n) => `Paso ${n} de 2`,
    back: 'Atrás',
    showWord: 'Ver la palabra',
    gotIt: 'Entendido',
    alreadyKnow: 'Ya me la sé',
    quickCheck: 'Comprobación rápida',
    left: (n) => (n === 1 ? '1 restante' : `${n} restantes`),
    learned: (n) => ` · ${n} ${n === 1 ? 'aprendida' : 'aprendidas'}`,
    alreadyKnown: (n) => ` · ${n} ya ${n === 1 ? 'conocida' : 'conocidas'}`,
    niceWork: '¡Buen trabajo!',
    wordsLearned: (n) => `${n} ${palabras(n)} ${n === 1 ? 'aprendida' : 'aprendidas'}`,
    comeBack: 'Volverán en Repasar cuando les toque.',
    trainNow: 'Repasar ahora',
    home: 'Inicio',
    noneReady: 'No hay palabras nuevas listas',
    nothingNow: 'Ahora mismo no hay nada nuevo que aprender',
    pending: (n) => (n === 1 ? 'Todavía se está preparando 1 palabra.' : `Todavía se están preparando ${n} palabras.`),
    addWords: 'Añadir palabras',
    limit: 'Límite diario alcanzado',
    newToday: (n, ready) => `${n} ${palabras(n)} ${n === 1 ? 'nueva' : 'nuevas'} hoy · ${ready} ${ready === 1 ? 'lista' : 'listas'}`,
    learnMore: (n) => `Aprender ${n} más`,
    trainInstead: 'Repasar en su lugar',
  },
)

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
  const t = useT(M)
  const ui = useUiLang()
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
  // The intro step of the card on screen (0: source word, 1: target word), and the sessions
  // before each "got it" of this group, so Left can go back to the previous intro card.
  const [introStep, setIntroStep] = useState<0 | 1>(0)
  const [history, setHistory] = useState<LearnSession[]>([])
  const swipe = useRef<{ x: number; y: number } | null>(null)
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
      setIntroStep(0)
      setHistory([])
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
  const intro = useMemo(() => (introCard ? introFaces(introCard, ui) : null), [introCard, ui])
  const checkCard = step?.kind === 'check' ? step.card : null
  const faces = useMemo(
    () => (checkCard ? cardFaces(checkCard, direction, { hideSentenceOnFront: settings?.hideSentenceOnFront, ui }) : null),
    [checkCard, direction, settings?.hideSentenceOnFront, ui],
  )
  const labels = useMemo(() => (checkCard && srs ? previewIntervals(srs, checkCard.id, checkCard.srs, Date.now(), ui) : null), [checkCard, srs, ui])

  // Autoplay the word when the intro reveals it (once per card).
  const autoplayed = useRef<string | null>(null)
  useEffect(() => {
    if (!introCard || !intro || introStep !== 1 || autoplayed.current === introCard.id) return
    autoplayed.current = introCard.id
    if (settings?.ttsAutoplay) speak([intro.speech.word], ttsLang)
  }, [introCard, intro, introStep, settings?.ttsAutoplay, ttsLang])

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
    const next = gotIt(session, step.card.id, t)
    // Back stays possible only while the next screen is another intro card of this group.
    setHistory((h) => (learnStep(next, t).kind === 'intro' ? [...h, session] : []))
    setSession(next)
    setIntroStep(0)
    setNow(t)
  }, [session, step])

  const introNext = useCallback(() => {
    if (introStep === 0) setIntroStep(1)
    else onGotIt()
  }, [introStep, onGotIt])

  const introBack = useCallback(() => {
    stopSpeaking()
    if (introStep === 1) return setIntroStep(0)
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    setSession(prev)
    setIntroStep(1)
  }, [introStep, history])

  const onAlreadyKnow = useCallback(() => {
    if (!session || step?.kind !== 'intro') return
    stopSpeaking()
    // Easy, as if the German side had been shown (target -> source).
    const t = record(step.card.id, 4, 'target-source')
    setSession(alreadyKnow(session, step.card.id, t))
    setHistory([])
    setIntroStep(0)
    setNow(t)
  }, [session, step, record])

  const grade = useCallback(
    (g: Grade) => {
      if (!checkCard || !session || !srs) return
      const t = record(checkCard.id, g, direction)
      const { after } = srs.review(checkCard.id, checkCard.srs, g, t)
      stopSpeaking()
      setSession(gradeCheck(session, checkCard, g, after, t))
      setHistory([])
      setIntroStep(0)
      setNow(t)
    },
    [checkCard, session, srs, record, direction],
  )

  // Intro keys (the quick check's keys live in AnswerCard): Right / Space forward, Left back.
  useEffect(() => {
    if (step?.kind !== 'intro') return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return
      const el = document.activeElement
      if (el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.key === 'ArrowRight' || ((e.key === ' ' || e.code === 'Space') && !(el instanceof HTMLButtonElement))) {
        e.preventDefault()
        introNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        introBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step?.kind, introNext, introBack])

  const learnMore = () => {
    clearResume(sessionStore())
    setSession(null)
    if (extra === LEARN_MORE_STEP) void query.refetch()
    else setParams({ extra: String(LEARN_MORE_STEP) })
  }

  if (!deck) {
    return (
      <Screen title={t.title}>
        <NoDecks />
      </Screen>
    )
  }

  const studied = session ? session.learned.length + session.alreadyKnew : 0
  const left = session ? remainingCount(session) : 0

  return (
    <Screen
      title={t.title}
      fill
      action={
        <Link to="/" className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm font-medium text-zinc-500 underline dark:text-zinc-400">
          {t.done}
        </Link>
      }
    >
      <ErrorText error={query.error ?? srsError ?? me.error} />
      {(query.isPending || !session) && !query.error && <p className={muted}>{t.loading}</p>}

      {session && step?.kind === 'intro' && intro && (
        <>
          <div className="flex shrink-0 items-center justify-between">
            <p className={muted}>{t.newWord}</p>
            <p className={muted} data-testid="intro-step">
              {t.step(introStep + 1)}
            </p>
          </div>
          <section
            data-testid="intro-card"
            className={`${studyCard} touch-pan-y`}
            aria-live="polite"
            aria-label={t.newWord}
            tabIndex={0}
            onPointerDown={(e) => {
              swipe.current = { x: e.clientX, y: e.clientY }
            }}
            onPointerUp={(e) => {
              const s = swipe.current
              swipe.current = null
              if (!s) return
              const dx = e.clientX - s.x
              if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(e.clientY - s.y)) return
              if (dx < 0) introNext()
              else introBack()
            }}
            onPointerCancel={() => {
              swipe.current = null
            }}
          >
            <LearnIntroCard
              card={introCard!}
              intro={intro}
              step={introStep}
              targetLang={targetLang}
              onSpeak={() => speak([intro.speech.word, intro.speech.sentence], ttsLang)}
            />
          </section>
          <div className={studyFooter}>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button
              type="button"
              aria-label={t.back}
              className="inline-flex h-12 min-w-12 items-center justify-center rounded-xl border border-zinc-300 px-4 font-medium disabled:opacity-40 dark:border-zinc-700"
              disabled={introStep === 0 && history.length === 0}
              onClick={introBack}
            >
              <span aria-hidden="true">←</span>
            </button>
            <button type="button" className={btnPrimary} onClick={introNext}>
              {introStep === 0 ? t.showWord : t.gotIt} <span aria-hidden="true" className="ml-2">→</span>
            </button>
          </div>
          <button type="button" className={btnSecondary} onClick={onAlreadyKnow}>
            {t.alreadyKnow}
          </button>
          </div>
        </>
      )}

      {session && step?.kind === 'check' && faces && (
        <>
          <p className={`${muted} shrink-0 text-center`}>{t.quickCheck}</p>
          <AnswerCard
            key={`${stepKey}:${direction}`}
            card={checkCard!}
            faces={faces}
            direction={direction}
            sourceLang={deck.sourceLang}
            targetLang={targetLang}
            labels={labels}
            canGrade={!!srs}
            autoplay={!!settings?.ttsAutoplay}
            onDone={grade}
          />
        </>
      )}

      {session && step && step.kind !== 'done' && (
        <p className={`${muted} shrink-0 text-center`}>
          {t.left(left)}
          {studied > 0 ? t.learned(session.learned.length) : ''}
          {session.alreadyKnew > 0 ? t.alreadyKnown(session.alreadyKnew) : ''}
        </p>
      )}

      {session && done && studied > 0 && (
        <section className={`${cardClass} flex flex-col gap-3 text-center`} role="status">
          <p className="text-xl font-semibold">{t.niceWork}</p>
          <p>
            {t.wordsLearned(session.learned.length)}
            {session.alreadyKnew > 0 ? t.alreadyKnown(session.alreadyKnew) : ''}
          </p>
          <p className={muted}>{t.comeBack}</p>
          <Link to="/train" className={btnPrimary}>
            {t.trainNow}
          </Link>
          <Link to="/" className={btnSecondary}>
            {t.home}
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
  const t = useT(M)
  if (info.readyNewTotal === 0 || info.remainingToday > 0) {
    return (
      <section className={`${cardClass} flex flex-col gap-3 text-center`}>
        <p className="text-xl font-semibold">{info.readyNewTotal === 0 ? t.noneReady : t.nothingNow}</p>
        {pending > 0 && <p className={muted}>{t.pending(pending)}</p>}
        <Link to="/add" className={btnPrimary}>
          {t.addWords}
        </Link>
        <Link to="/" className={btnSecondary}>
          {t.home}
        </Link>
      </section>
    )
  }
  return (
    <section className={`${cardClass} flex flex-col gap-3 text-center`}>
      <p className="text-xl font-semibold">{t.limit}</p>
      <p className={muted}>{t.newToday(info.newToday, info.readyNewTotal)}</p>
      <button type="button" className={btnPrimary} onClick={onLearnMore}>
        {t.learnMore(LEARN_MORE_STEP)}
      </button>
      <Link to="/train" className={btnSecondary}>
        {t.trainInstead}
      </Link>
    </section>
  )
}
