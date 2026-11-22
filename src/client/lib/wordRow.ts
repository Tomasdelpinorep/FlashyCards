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
 * Friendly text for a failed card. `genError` holds either 'not_a_word' or a raw technical error
 * (an AI/validation message), which is never shown as such.
 */
export function failedText(genError: string | null): string {
  return genError === 'not_a_word' ? 'Not recognised as a word' : "Couldn't be prepared · try Retry later"
}
