/**
 * Train (PLAN.md section 6, DUPLICATES.md 10.8): review due cards in the chosen direction.
 * The learner types (or says) the answer; components/AnswerCard.tsx checks it, flips and picks
 * the grade (overridable, keys 1-4). Grading is optimistic: the next card shows at once, the review
 * goes to the outbox (lib/outbox.ts), and learning steps due again soon return to the session
 * queue (lib/session.ts). The "Auto" switch in the header (lib/handsFree.ts) moves on by itself
 * after a correct answer; with the mic switch on, Train runs hands-free.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { cardFaces, pickDirection, type FaceDirection } from '../../shared/display'
import type { StudyDirection } from '../../shared/schemas'
import { formatInterval, loadSrs, previewIntervals, type Grade, type Srs } from '../../shared/srs'
import { NoDecks } from '../components/NoDecks'
import { AnswerCard } from '../components/AnswerCard'
import { btnSecondary, card as cardClass, ErrorText, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { autoSwitch, useSwitch } from '../lib/handsFree'
import { enqueueReview, useMe, useReviewQueue, useUpdateMe } from '../lib/queries'
import { currentCard, gradeCard, startSession, type Session } from '../lib/session'
import { stopSpeaking } from '../lib/tts'
import { messages, useT, useUiLang } from '../lib/i18n'

const M = messages(
  {
    title: 'Train',
    done: 'Done',
    mixed: 'Mixed',
    direction: 'Direction',
    loading: 'Loading…',
    left: (n: number) => `${n} left`,
    reviewed: (n: number) => ` · ${n} reviewed`,
    autoLabel: 'Auto mode: move on by itself',
    auto: 'Auto',
    now: 'now',
    inTime: (d: string) => `in ${d}`,
    allDone: 'All done',
    nextCard: (when: string) => ` · Next card ${when}`,
    summary: (n: number, pct: number) => `${n} ${n === 1 ? 'card' : 'cards'} reviewed · ${pct}% correct`,
    nothing: 'Nothing to review yet. Words you study will show up here.',
    practice: 'Practice anyway',
  },
  {
    title: 'Repasar',
    done: 'Hecho',
    mixed: 'Mixto',
    direction: 'Dirección',
    loading: 'Cargando…',
    left: (n) => (n === 1 ? '1 restante' : `${n} restantes`),
    reviewed: (n) => ` · ${n} ${n === 1 ? 'repasada' : 'repasadas'}`,
    autoLabel: 'Modo automático: pasa solo a la siguiente',
    auto: 'Auto',
    now: 'ahora',
    inTime: (d) => `en ${d}`,
    allDone: 'Todo hecho',
    nextCard: (when) => ` · Siguiente tarjeta ${when}`,
    summary: (n, pct) => `${n} ${n === 1 ? 'tarjeta repasada' : 'tarjetas repasadas'} · ${pct}% correctas`,
    nothing: 'Todavía no hay nada que repasar. Aquí aparecerán las palabras que estudies.',
    practice: 'Practicar de todos modos',
  },
)

const TICK_MS = 15_000

export function Train() {
  const tr = useT(M)
  const ui = useUiLang()
  const { deck } = useCurrentDeck()
  const me = useMe()
  const updateMe = useUpdateMe()
  const qc = useQueryClient()
  const settings = me.data?.user.settings
  const [mode, setMode] = useState<StudyDirection>(settings?.studyDirection ?? 'target-source')
  const [ahead, setAhead] = useState(false)
  const query = useReviewQueue(deck?.id, ahead)
  const [srs, setSrs] = useState<Srs | null>(null)
  const [srsError, setSrsError] = useState<unknown>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [flipped, setFlipped] = useState(false)
  const auto = useSwitch(autoSwitch)
  const [nextDue, setNextDue] = useState<number | null>(null)
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

  // A fresh queue (first load, or "Practice anyway") starts a new session.
  useEffect(() => {
    if (!query.data) return
    setSession(startSession(query.data.cards))
    setNextDue(query.data.nextDueAt)
    setFlipped(false)
    setNow(Date.now())
  }, [query.data])

  // Learning steps come due while the screen is open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => stopSpeaking, [])

  const current = session ? currentCard(session, now) : null
  const cardKey = current && session ? `${current.id}:${session.reviewed}` : null
  if (current && cardKey && shown.current?.key !== cardKey) {
    shown.current = { key: cardKey, direction: pickDirection(mode), at: Date.now() }
  }
  const direction = shown.current?.direction ?? 'target-source'

  const faces = useMemo(
    () => (current ? cardFaces(current, direction, { hideSentenceOnFront: settings?.hideSentenceOnFront, ui }) : null),
    [current, direction, settings?.hideSentenceOnFront, ui],
  )
  const labels = useMemo(() => (current && srs ? previewIntervals(srs, current.id, current.srs, Date.now(), ui) : null), [current, srs, ui])

  const targetLang = deck?.targetLang ?? ''
  const sourceLang = deck?.sourceLang ?? ''
  const onReveal = useCallback(() => setFlipped(true), [])

  const grade = useCallback(
    (g: Grade) => {
      if (!current || !session || !srs || !deck) return
      const reviewedAt = Date.now()
      const { after } = srs.review(current.id, current.srs, g, reviewedAt)
      enqueueReview(qc, deck.id, {
        id: crypto.randomUUID(),
        cardId: current.id,
        rating: g,
        direction,
        reviewedAt,
        durationMs: Math.min(86_400_000, Math.max(0, reviewedAt - (shown.current?.at ?? reviewedAt))),
      })
      stopSpeaking()
      setSession(gradeCard(session, current, g, after, reviewedAt))
      setNextDue((n) => (n === null || after.due < n ? after.due : n))
      setFlipped(false)
      setNow(reviewedAt)
    },
    [current, session, srs, deck, direction, qc],
  )

  const changeMode = (m: StudyDirection) => {
    setMode(m)
    if (settings?.studyDirection !== m) updateMe.mutate({ settings: { studyDirection: m } })
    // Re-pick the direction of the card on screen unless it was already flipped.
    if (!flipped && shown.current) shown.current = { ...shown.current, direction: pickDirection(m) }
    setNow(Date.now())
  }

  if (!deck) {
    return (
      <Screen title={tr.title}>
        <NoDecks />
      </Screen>
    )
  }

  const t = targetLang.toUpperCase()
  const s = sourceLang.toUpperCase()
  const modes: [StudyDirection, string][] = [
    ['target-source', `${t}→${s}`],
    ['source-target', `${s}→${t}`],
    ['mixed', tr.mixed],
  ]

  return (
    <Screen
      title={tr.title}
      fill
      action={
        <div className="flex items-center gap-2">
          <AutoSwitch on={auto} onToggle={() => autoSwitch.set(!auto)} />
          <Link to="/" className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm font-medium text-zinc-500 underline dark:text-zinc-400">
            {tr.done}
          </Link>
        </div>
      }
    >
      <div role="radiogroup" aria-label={tr.direction} className="grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
        {modes.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => changeMode(m)}
            className={`min-h-11 rounded-lg px-2 text-sm font-medium ${mode === m ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-600 dark:text-zinc-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <ErrorText error={query.error ?? srsError ?? updateMe.error} />
      {(query.isPending || !session) && !query.error && <p className={muted}>{tr.loading}</p>}

      {session && current && faces && (
        <>
          <AnswerCard
            key={`${cardKey}:${direction}`}
            card={current}
            faces={faces}
            direction={direction}
            sourceLang={sourceLang}
            targetLang={targetLang}
            labels={labels}
            canGrade={!!srs}
            autoplay={!!settings?.ttsAutoplay}
            autoAdvance={auto}
            onReveal={onReveal}
            onDone={grade}
          />
          <p className={`${muted} shrink-0 text-center`}>
            {tr.left(session.queue.length + session.again.length)}
            {session.reviewed > 0 ? tr.reviewed(session.reviewed) : ''}
          </p>
        </>
      )}

      {session && !current && (
        <AllDone
          session={session}
          nextDue={nextDue}
          now={now}
          canPracticeAhead={nextDue !== null}
          onPractice={() => {
            if (ahead) void query.refetch()
            else setAhead(true)
          }}
        />
      )}
    </Screen>
  )
}

/** "Auto": move on by itself after a correct answer (a switch, remembered on this device). */
function AutoSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const t = useT(M)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t.autoLabel}
      onClick={onToggle}
      className="inline-flex min-h-11 items-center gap-2 px-1 text-sm font-medium text-zinc-600 dark:text-zinc-300"
    >
      <span aria-hidden="true">{t.auto}</span>
      <span
        aria-hidden="true"
        className={`relative inline-block h-6 w-10 rounded-full border transition-colors ${
          on ? 'border-green-700 bg-green-700 dark:border-green-500 dark:bg-green-600' : 'border-zinc-400 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-800'
        }`}
      >
        <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-[left] ${on ? 'left-[1.1rem]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

function AllDone({
  session,
  nextDue,
  now,
  canPracticeAhead,
  onPractice,
}: {
  session: Session
  nextDue: number | null
  now: number
  canPracticeAhead: boolean
  onPractice: () => void
}) {
  const t = useT(M)
  const ui = useUiLang()
  const next = nextDue === null ? null : nextDue <= now ? t.now : t.inTime(formatInterval(nextDue - now, ui))
  const accuracy = session.reviewed > 0 ? Math.round((100 * session.correct) / session.reviewed) : null
  return (
    <section className={`${cardClass} flex flex-col gap-3 text-center`}>
      <p className="text-xl font-semibold">{t.allDone}
        {next ? t.nextCard(next) : ''}</p>
      {accuracy !== null && (
        <p className={muted}>
          {t.summary(session.reviewed, accuracy)}
        </p>
      )}
      {!canPracticeAhead && session.reviewed === 0 && <p className={muted}>{t.nothing}</p>}
      {canPracticeAhead && (
        <button type="button" className={btnSecondary} onClick={onPractice}>
          {t.practice}
        </button>
      )}
    </section>
  )
}

