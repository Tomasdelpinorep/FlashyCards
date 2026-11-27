import { Link } from 'react-router'
import { GenerationBanner } from '../components/GenerationBanner'
import { NoDecks } from '../components/NoDecks'
import { btnPrimary, btnSecondary, card, ErrorText, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useDeckStats } from '../lib/queries'
import { LEARN_MORE_STEP } from '../lib/learnSession'
import { messages, useT } from '../lib/i18n'

const M = messages(
  {
    title: 'Flashcards',
    deck: 'Deck',
    duplicates: (n: number) => `${n === 1 ? '1 word was' : `${n} words were`} already in your deck ·`,
    view: 'View',
    emptyTitle: 'Add words to start',
    emptyBody:
      'Pick the most common words to learn, or import your own list (one word per line, or a CSV / text file). Words from the dictionary come with a translation and an example sentence.',
    addWords: 'Add words',
    importList: 'Import a list',
    noneReady: 'None of your words are ready to study yet.',
    beingLookedUp: 'They are being looked up; this page updates when they are.',
    addMeanings: 'Add their meanings in Words, or add new words.',
    stats: 'Deck stats',
    words: 'Words',
    dueNow: 'Due now',
    new: 'New',
    learning: 'Learning',
    preparing: 'Preparing',
    needMeaning: 'Need meaning',
    train: (due: string) => `Train · ${due} due`,
    reviewedToday: (n: number) => `${n} reviewed today`,
    dueLater: (n: number) => ` · ${n} more due later today`,
    howTo: 'How to use the app',
    learnNew: (ready: string) => `Learn new · ${ready} ready`,
    limitReached: (n: number) => `Daily limit reached · Learn ${n} more`,
  },
  {
    title: 'Flashcards',
    deck: 'Mazo',
    duplicates: (n) => `${n === 1 ? '1 palabra ya estaba' : `${n} palabras ya estaban`} en tu mazo ·`,
    view: 'Ver',
    emptyTitle: 'Añade palabras para empezar',
    emptyBody:
      'Elige las palabras más comunes para aprender, o importa tu propia lista (una palabra por línea, o un archivo CSV / de texto). Las palabras del diccionario vienen con una traducción y una frase de ejemplo.',
    addWords: 'Añadir palabras',
    importList: 'Importar una lista',
    noneReady: 'Ninguna de tus palabras está lista para estudiar todavía.',
    beingLookedUp: 'Se están buscando; esta página se actualiza cuando terminen.',
    addMeanings: 'Añade sus significados en Palabras, o añade palabras nuevas.',
    stats: 'Estadísticas del mazo',
    words: 'Palabras',
    dueNow: 'Pendientes',
    new: 'Nuevas',
    learning: 'Aprendiendo',
    preparing: 'Preparando',
    needMeaning: 'Sin significado',
    train: (due) => `Repasar · ${due} pendientes`,
    reviewedToday: (n) => (n === 1 ? '1 repasada hoy' : `${n} repasadas hoy`),
    dueLater: (n) => ` · ${n} más pendientes hoy más tarde`,
    howTo: 'Cómo se usa la app',
    learnNew: (ready) => `Aprender nuevas · ${ready} listas`,
    limitReached: (n) => `Límite diario alcanzado · Aprender ${n} más`,
  },
)

export function Home() {
  const { deck, decks, selectDeck } = useCurrentDeck()
  const t = useT(M)
  const stats = useDeckStats(deck?.id)

  if (!deck) {
    return (
      <Screen title={t.title}>
        <NoDecks />
        <HowToLink />
      </Screen>
    )
  }

  const s = stats.data
  return (
    <Screen
      title={t.title}
      action={
        decks.length > 1 ? (
          <label className="flex items-center">
            <span className="sr-only">{t.deck}</span>
            <select
              className="min-h-11 max-w-44 truncate rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900"
              value={deck.id}
              onChange={(e) => selectDeck(e.target.value)}
            >
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400" data-testid="deck-name">
            {deck.name}
          </span>
        )
      }
    >
      <ErrorText error={stats.error} />

      <GenerationBanner deckId={deck.id} stats={s} />
      {s && s.duplicates > 0 && (
        <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
          {t.duplicates(s.duplicates)}{' '}
          <Link className="font-medium underline" to="/words?status=duplicate">
            {t.view}
          </Link>
        </p>
      )}

      {s && s.total === 0 ? (
        <section className={`${card} flex flex-col gap-3`} data-testid="empty-deck">
          <h2 className="text-lg font-semibold">{t.emptyTitle}</h2>
          <p className="text-sm">{t.emptyBody}</p>
          <Link to="/add" className={btnPrimary}>
            {t.addWords}
          </Link>
          <Link to="/add?tab=import" className={btnSecondary}>
            {t.importList}
          </Link>
        </section>
      ) : (
        <>
          {s && s.ready === 0 && s.pending + s.failed > 0 && (
            <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900" data-testid="none-ready">
              {t.noneReady} {s.pending > 0 ? t.beingLookedUp : t.addMeanings}
            </p>
          )}
          <section className={`${card} grid grid-cols-3 gap-2 text-center`} aria-label={t.stats} aria-busy={stats.isPending}>
            <Stat label={t.words} value={s?.total} />
            <Stat label={t.dueNow} value={s?.dueNow} />
            <Stat label={t.new} value={s?.new} />
            <Stat label={t.learning} value={s?.learning} />
            <Stat label={t.preparing} value={s?.pending} />
            <Stat label={t.needMeaning} value={s?.failed} />
          </section>

          <Link to="/train" className={btnPrimary}>
            {t.train(String(s?.dueNow ?? '–'))}
          </Link>
          {s && (s.reviewedToday > 0 || s.dueToday > s.dueNow) && (
            <p className={`${muted} text-center`}>
              {t.reviewedToday(s.reviewedToday)}
              {s.dueToday > s.dueNow ? t.dueLater(s.dueToday - s.dueNow) : ''}
            </p>
          )}
          <LearnButton readyNew={s?.new} newToday={s?.newToday} dailyNewLimit={deck.settings.dailyNewLimit} />
          <Link to="/add" className={btnSecondary}>
            {t.addWords}
          </Link>
        </>
      )}
      <HowToLink />
    </Screen>
  )
}

/** Shown on every Home state (no deck, empty deck, normal). */
function HowToLink() {
  const t = useT(M)
  return (
    <Link to="/how-to" className="mx-auto inline-flex min-h-11 items-center px-3 text-sm font-medium text-zinc-600 underline underline-offset-2 dark:text-zinc-300">
      {t.howTo}
    </Link>
  )
}

/** "Learn new · N ready", or "Daily limit reached · Learn 5 more" once today's new cards are used up. */
function LearnButton({ readyNew, newToday, dailyNewLimit }: { readyNew?: number; newToday?: number; dailyNewLimit: number }) {
  const t = useT(M)
  if (readyNew === undefined || newToday === undefined || readyNew === 0) {
    return (
      <span className={`${btnSecondary} opacity-40`} aria-disabled="true">
        {t.learnNew(String(readyNew ?? '–'))}
      </span>
    )
  }
  const remaining = Math.max(0, dailyNewLimit - newToday)
  if (remaining === 0) {
    return (
      <Link to={`/learn?extra=${LEARN_MORE_STEP}`} className={btnSecondary}>
        {t.limitReached(LEARN_MORE_STEP)}
      </Link>
    )
  }
  return (
    <Link to="/learn" className={btnSecondary}>
      {t.learnNew(String(readyNew))}
    </Link>
  )
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex flex-col py-1">
      <span className="text-2xl font-semibold tabular-nums">{value ?? '–'}</span>
      <span className={muted}>{label}</span>
    </div>
  )
}
