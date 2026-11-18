import { Link, useNavigate, useParams } from 'react-router'
import { duplicateOfText, formsLine, translationLine } from '../../shared/display'
import { btnSecondary, card as cardClass, ErrorText, muted, Screen, Sentence, Word } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useCard, useDeleteCard, useRetryFailed } from '../lib/queries'
import { useGeneration } from '../lib/generation'

/** A single word: the generated content (M4). Editing, suspending and regenerating arrive in M8. */
export function CardDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { deck } = useCurrentDeck()
  const query = useCard(id)
  const remove = useDeleteCard(deck?.id ?? '')
  const retry = useRetryFailed(deck?.id ?? '')
  const { start } = useGeneration()
  const c = query.data
  const lang = deck?.targetLang ?? ''

  return (
    <Screen
      title="Word"
      action={
        <Link to="/words" className="text-sm font-medium text-zinc-500 underline dark:text-zinc-400">
          Back to words
        </Link>
      }
    >
      <ErrorText error={query.error ?? remove.error ?? retry.error} />
      {query.isPending && <p className={muted}>Loading…</p>}
      {c && (
        <>
          <section className={`${cardClass} flex flex-col gap-3`}>
            <div>
              <p className="text-3xl font-semibold tracking-tight">
                <Word text={c.display} lang={lang} />
              </p>
              {formsLine(c.content) && <p className={muted}>{formsLine(c.content)}</p>}
            </div>
            {c.content ? (
              <>
                <p className="text-lg">{translationLine(c.translation, c.extraTranslations)}</p>
                {c.content.altTranslations.length > 0 && <p className={muted}>Other meanings: {c.content.altTranslations.join(', ')}</p>}
                <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <Sentence text={c.content.exampleTarget} className="text-base" />
                  <Sentence text={c.content.exampleSource} className={muted} />
                </div>
                {(c.content.cefr || c.content.pos) && <p className={muted}>{[c.content.pos, c.content.cefr].filter(Boolean).join(' · ')}</p>}
              </>
            ) : c.status === 'pending' ? (
              <p className={muted}>Preparing the translation and an example sentence…</p>
            ) : c.status === 'failed' ? (
              <p className="text-sm text-red-700 dark:text-red-400">
                {c.genError === 'not_a_word' ? `“${c.inputTerm}” was not recognised as a word.` : "This word couldn't be prepared."}
              </p>
            ) : null}
            {c.inputHint && <p className={muted}>Your hint: {c.inputHint}</p>}
            {c.status === 'duplicate' && c.duplicateOf && (
              <p className="text-sm">
                {duplicateOfText(undefined)} as{' '}
                <Link className="font-medium underline" to={`/words/${c.duplicateOf.id}`}>
                  {c.duplicateOf.display}
                </Link>
                .
              </p>
            )}
            {c.alsoInDeck && c.alsoInDeck.length > 0 && (
              <p className={muted}>
                Also in your deck:{' '}
                {c.alsoInDeck.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 && ', '}
                    <Link className="underline" to={`/words/${o.id}`}>
                      {o.display}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </section>

          {c.status === 'failed' && (
            <button type="button" className={btnSecondary} disabled={retry.isPending} onClick={() => retry.mutate(undefined, { onSuccess: () => start() })}>
              {retry.isPending ? 'Retrying…' : 'Retry failed words'}
            </button>
          )}
          {c.status !== 'duplicate' && (
            <button
              type="button"
              className={`${btnSecondary} text-red-700 dark:text-red-400`}
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`Delete “${c.display}”?`)) remove.mutate(c.id, { onSuccess: () => navigate('/words', { replace: true }) })
              }}
            >
              Delete
            </button>
          )}
        </>
      )}
    </Screen>
  )
}
