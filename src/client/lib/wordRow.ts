/** The two lines of a row in the Words list (pure, unit-tested). */
import { duplicateOfText, translationLine } from '../../shared/display'
import type { UiLanguage } from '../../shared/languages'
import type { CardDTO } from '../../shared/schemas'

type RowCard = Pick<CardDTO, 'status' | 'display' | 'inputTerm' | 'inputHint' | 'translation' | 'extraTranslations' | 'genError' | 'duplicateOf'>

const COPY = {
  en: {
    preparing: 'Preparing…',
    suspended: 'Suspended',
    needsMeaning: 'Not in the dictionary · add its meaning',
    notAWord: 'Not recognised as a word · add its meaning',
    lookupFailed: "Couldn't be looked up · retry or add its meaning",
  },
  es: {
    preparing: 'Preparando…',
    suspended: 'Suspendida',
    needsMeaning: 'No está en el diccionario · añade su significado',
    notAWord: 'No se reconoce como palabra · añade su significado',
    lookupFailed: 'No se pudo buscar · reinténtalo o añade su significado',
  },
} as const

export function wordRowText(card: RowCard, ui: UiLanguage = 'en'): { title: string; hint: string | null; subtitle: string } {
  const c = COPY[ui]
  // A duplicate resolved to the same word as the card it duplicates, so its `display` is that
  // card's word ("der Hund" twice): show what the user actually typed instead ("dog").
  const title = card.status === 'duplicate' ? card.inputTerm : card.display
  const hint = card.inputHint && (card.status === 'pending' || card.status === 'duplicate') ? card.inputHint : null
  const subtitle =
    card.status === 'pending'
      ? c.preparing
      : card.status === 'duplicate'
        ? duplicateOfText(card.duplicateOf, ui)
        : card.status === 'failed'
          ? failedText(card.genError, ui)
          : card.status === 'suspended'
            ? [c.suspended, translationLine(card.translation, card.extraTranslations, ui)].filter(Boolean).join(' · ')
            : translationLine(card.translation, card.extraTranslations, ui) || card.inputHint || ''
  return { title, hint, subtitle }
}

/**
 * Friendly text for a failed card ("Needs meaning"). `genError` holds 'needs_meaning' (not in the
 * dictionary), 'not_a_word', or a raw technical error, which is never shown as such.
 */
export function failedText(genError: string | null, ui: UiLanguage = 'en'): string {
  if (genError === 'needs_meaning') return COPY[ui].needsMeaning
  if (genError === 'not_a_word') return COPY[ui].notAWord
  return COPY[ui].lookupFailed
}

type Status = RowCard['status']

/** Pill labels per app language (STATUS_BADGE holds the English ones and the colours). */
const STATUS_LABELS: Record<UiLanguage, Record<Status, string>> = {
  en: { pending: 'Preparing', ready: 'Ready', failed: 'Needs meaning', suspended: 'Suspended', duplicate: 'Duplicate', deleted: 'Deleted' },
  es: { pending: 'Preparando', ready: 'Lista', failed: 'Falta el significado', suspended: 'Suspendida', duplicate: 'Duplicada', deleted: 'Eliminada' },
}

/** A status pill's label in the app language. */
export const statusLabel = (status: Status, ui: UiLanguage = 'en'): string => STATUS_LABELS[ui][status]

/** Short label + pill colours for a card status (one place; used by Words rows and CardDetail). */
export const STATUS_BADGE: Record<Status, { label: string; className: string }> = {
  pending: { label: STATUS_LABELS.en.pending, className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' },
  ready: { label: STATUS_LABELS.en.ready, className: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200' },
  failed: { label: STATUS_LABELS.en.failed, className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' },
  suspended: { label: STATUS_LABELS.en.suspended, className: 'bg-rose-200 text-rose-950 dark:bg-rose-900 dark:text-rose-100' },
  duplicate: { label: STATUS_LABELS.en.duplicate, className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200' },
  // Never listed (deleted cards are filtered out server-side); here only to keep the map total.
  deleted: { label: STATUS_LABELS.en.deleted, className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
}

export const badgeBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'
