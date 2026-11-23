/** The two lines of a row in the Words list (pure, unit-tested). */
import { duplicateOfText, translationLine } from '../../shared/display'
import type { CardDTO } from '../../shared/schemas'

type RowCard = Pick<CardDTO, 'status' | 'display' | 'inputTerm' | 'inputHint' | 'translation' | 'extraTranslations' | 'genError' | 'duplicateOf'>

export function wordRowText(card: RowCard): { title: string; hint: string | null; subtitle: string } {
  // A duplicate resolved to the same word as the card it duplicates, so its `display` is that
  // card's word ("der Hund" twice): show what the user actually typed instead ("dog").
  const title = card.status === 'duplicate' ? card.inputTerm : card.display
  const hint = card.inputHint && (card.status === 'pending' || card.status === 'duplicate') ? card.inputHint : null
  const subtitle =
    card.status === 'pending'
      ? 'Preparing…'
      : card.status === 'duplicate'
        ? duplicateOfText(card.duplicateOf)
        : card.status === 'failed'
          ? failedText(card.genError)
          : card.status === 'suspended'
            ? ['Suspended', translationLine(card.translation, card.extraTranslations)].filter(Boolean).join(' · ')
            : translationLine(card.translation, card.extraTranslations) || card.inputHint || ''
  return { title, hint, subtitle }
}

/**
 * Friendly text for a failed card ("Needs meaning"). `genError` holds 'needs_meaning' (not in the
 * dictionary), 'not_a_word', or a raw technical error, which is never shown as such.
 */
export function failedText(genError: string | null): string {
  if (genError === 'needs_meaning') return 'Not in the dictionary · add its meaning'
  if (genError === 'not_a_word') return 'Not recognised as a word · add its meaning'
  return "Couldn't be looked up · retry or add its meaning"
}

/** Short label + pill colours for a card status (one place; used by Words rows and CardDetail). */
export const STATUS_BADGE: Record<RowCard['status'], { label: string; className: string }> = {
  pending: { label: 'Preparing', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' },
  ready: { label: 'Ready', className: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200' },
  failed: { label: 'Needs meaning', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' },
  suspended: { label: 'Suspended', className: 'bg-rose-200 text-rose-950 dark:bg-rose-900 dark:text-rose-100' },
  duplicate: { label: 'Duplicate', className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200' },
  // Never listed (deleted cards are filtered out server-side); here only to keep the map total.
  deleted: { label: 'Deleted', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
}

export const badgeBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'
