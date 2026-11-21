/**
 * Train (PLAN.md section 6, DUPLICATES.md 10.8): review due cards in the chosen direction.
 * Space / tap flips, 1-4 grade. Grading is optimistic: the next card shows at once, the review
 * goes to the outbox (lib/outbox.ts), and learning steps due again soon return to the session
 * queue (lib/session.ts).
 */
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { cardFaces, pickDirection, type FaceDirection } from '../../shared/display'
import { isLanguageCode, LANGUAGES } from '../../shared/languages'
import type { StudyDirection } from '../../shared/schemas'
import { formatInterval, GRADE_LABELS, GRADES, loadSrs, previewIntervals, type Grade, type Srs } from '../../shared/srs'
import { NoDecks } from '../components/NoDecks'
import { btnPrimary, btnSecondary, card as cardClass, ErrorText, muted, Screen, Sentence, Word } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { getOutbox } from '../lib/outbox'
import { keys, useMe, useReviewQueue, useUpdateMe } from '../lib/queries'
import { currentCard, gradeCard, startSession, type Session } from '../lib/session'
import { speak, stopSpeaking, ttsSupported } from '../lib/tts'

const TICK_MS = 15_000

const GRADE_STYLES: Record<Grade, string> = {
  1: 'border-red-300 text-red-800 dark:border-red-800 dark:text-red-300',
  2: 'border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300',
  3: 'border-green-300 text-green-800 dark:border-green-800 dark:text-green-300',
  4: 'border-blue-300 text-blue-800 dark:border-blue-800 dark:text-blue-300',
}

export function Train() {
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
    () => (current ? cardFaces(current, direction, { hideSentenceOnFront: settings?.hideSentenceOnFront }) : null),
    [current, direction, settings?.hideSentenceOnFront],
  )
  const labels = useMemo(() => (current && srs ? previewIntervals(srs, current.id, current.srs, Date.now()) : null), [current, srs])

  const targetLang = deck?.targetLang ?? ''
  const sourceLang = deck?.sourceLang ?? ''
  const ttsLang = isLanguageCode(targetLang) ? LANGUAGES[targetLang].ttsLang : targetLang

  const flip = useCallback(() => {
    if (!faces || flipped) return
    setFlipped(true)
    if (settings?.ttsAutoplay) speak([faces.speech.word], ttsLang)
  }, [faces, flipped, settings?.ttsAutoplay, ttsLang])

  const grade = useCallback(
    (g: Grade) => {
      if (!current || !session || !srs || !flipped || !deck) return
      const reviewedAt = Date.now()
      const { after } = srs.review(current.id, current.srs, g, reviewedAt)
      const outbox = getOutbox()
      outbox.enqueue({
        id: crypto.randomUUID(),
        cardId: current.id,
        rating: g,
        direction,
        reviewedAt,
        durationMs: Math.min(86_400_000, Math.max(0, reviewedAt - (shown.current?.at ?? reviewedAt))),
      })
      void outbox.flush().then(() => qc.invalidateQueries({ queryKey: keys.stats(deck.id) }))
      stopSpeaking()
      setSession(gradeCard(session, current, g, after, reviewedAt))
      setNextDue((n) => (n === null || after.due < n ? after.due : n))
      setFlipped(false)
      setNow(reviewedAt)
    },
    [current, session, srs, flipped, deck, direction, qc],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        flip()
      } else if (/^[1-4]$/.test(e.key)) grade(Number(e.key) as Grade)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip, grade])

  const changeMode = (m: StudyDirection) => {
    setMode(m)
    if (settings?.studyDirection !== m) updateMe.mutate({ settings: { studyDirection: m } })
    // Re-pick the direction of the card on screen unless it was already flipped.
    if (!flipped && shown.current) shown.current = { ...shown.current, direction: pickDirection(m) }
    setNow(Date.now())
  }

  if (!deck) {
    return (
      <Screen title="Train">
        <NoDecks />
      </Screen>
    )
  }

  const t = targetLang.toUpperCase()
  const s = sourceLang.toUpperCase()
  const modes: [StudyDirection, string][] = [
    ['target-source', `${t}→${s}`],
    ['source-target', `${s}→${t}`],
    ['mixed', 'Mixed'],
  ]

  return (
    <Screen
      title="Train"
      action={
        <Link to="/" className="text-sm font-medium text-zinc-500 underline dark:text-zinc-400">
          Done
        </Link>
      }
    >
      <div role="radiogroup" aria-label="Direction" className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
        {modes.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => changeMode(m)}
            className={`h-9 rounded-lg text-sm font-medium ${mode === m ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <ErrorText error={query.error ?? srsError ?? updateMe.error} />
      {(query.isPending || !session) && !query.error && <p className={muted}>Loading…</p>}

      {session && current && faces && (
        <>
          <section
            className={`${cardClass} flex min-h-72 cursor-pointer flex-col justify-center gap-4 text-center select-none`}
            onClick={flip}
            aria-live="polite"
          >
            {!flipped ? (
              <Front faces={faces} lang={targetLang} />
            ) : (
              <Back faces={faces} lang={targetLang} onSpeak={() => speak([faces.speech.word, faces.speech.sentence], ttsLang)} />
            )}
          </section>

          {!flipped ? (
            <button type="button" className={btnPrimary} onClick={flip}>
              Show answer <span className="ml-2 text-xs opacity-60">Space</span>
            </button>
          ) : (
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you know it?">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  disabled={!srs}
                  onClick={() => grade(g)}
                  className={`flex h-16 flex-col items-center justify-center rounded-xl border text-sm font-medium disabled:opacity-40 ${GRADE_STYLES[g]}`}
                >
                  <span>{GRADE_LABELS[g]}</span>
                  <span className="text-xs tabular-nums opacity-70">{labels?.[g] ?? '…'}</span>
                </button>
              ))}
            </div>
          )}
          <p className={`${muted} text-center`}>
            {session.queue.length + session.again.length} left{session.reviewed > 0 ? ` · ${session.reviewed} reviewed` : ''}
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

function Front({ faces, lang }: { faces: ReturnType<typeof cardFaces>; lang: string }) {
  const f = faces.front
  if (f.kind === 'target') {
    return (
      <>
        <p className="text-4xl font-semibold tracking-tight">
          <Word text={f.word} lang={lang} />
        </p>
        {f.sentence && <p className="text-lg text-zinc-600 dark:text-zinc-300">{f.sentence}</p>}
      </>
    )
  }
  return (
    <>
      <p className="text-3xl font-semibold tracking-tight">{f.translation}</p>
      <Sentence text={f.sentence} className="text-lg text-zinc-600 dark:text-zinc-300" />
    </>
  )
}

function Back({ faces, lang, onSpeak }: { faces: ReturnType<typeof cardFaces>; lang: string; onSpeak: () => void }) {
  const b = faces.back
  return (
    <>
      <div>
        <p className="text-4xl font-semibold tracking-tight">
          <Word text={b.word} lang={lang} />
        </p>
        {b.forms && <p className={muted}>{b.forms}</p>}
      </div>
      <p className="text-xl">{b.translation}</p>
      <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <Sentence text={b.exampleTarget} className="text-base" />
        <Sentence text={b.exampleSource} className={muted} />
      </div>
      {b.alsoInDeck.length > 0 && <p className={muted}>Also in your deck: {b.alsoInDeck.map((o) => o.display).join(', ')}</p>}
      {ttsSupported() && (
        <button
          type="button"
          className="mx-auto inline-flex h-9 items-center rounded-lg border border-zinc-300 px-3 text-sm font-medium dark:border-zinc-700"
          onClick={(e) => {
            e.stopPropagation()
            onSpeak()
          }}
        >
          Listen
        </button>
      )}
    </>
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
  const next = nextDue === null ? null : nextDue <= now ? 'now' : `in ${formatInterval(nextDue - now)}`
  const accuracy = session.reviewed > 0 ? Math.round((100 * session.correct) / session.reviewed) : null
  return (
    <section className={`${cardClass} flex flex-col gap-3 text-center`}>
      <p className="text-xl font-semibold">All done{next ? ` · Next card ${next}` : ''}</p>
      {accuracy !== null && (
        <p className={muted}>
          {session.reviewed} {session.reviewed === 1 ? 'card' : 'cards'} reviewed · {accuracy}% correct
        </p>
      )}
      {!canPracticeAhead && session.reviewed === 0 && <p className={muted}>Nothing to review yet. Words you study will show up here.</p>}
      {canPracticeAhead && (
        <button type="button" className={btnSecondary} onClick={onPractice}>
          Practice anyway
        </button>
      )}
    </section>
  )
}

