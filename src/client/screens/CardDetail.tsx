import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { duplicateOfText, formsLine, translationLine } from '../../shared/display'
import { MAX_EXTRA_TRANSLATIONS, NOTE_MAX, type CardDTO } from '../../shared/schemas'
import { btnPrimary, btnSecondary, btnSmall, card as cardClass, ErrorText, input, muted, Screen, Sentence, Word } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useCard, useDeleteCard, useRetryFailed, useUpdateCard } from '../lib/queries'
import { useGeneration } from '../lib/generation'
import { badgeBase, failedText, STATUS_BADGE } from '../lib/wordRow'

/** A single word: the generated content, editing and suspending (M8). */
export function CardDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { deck } = useCurrentDeck()
  const query = useCard(id)
  const remove = useDeleteCard(deck?.id ?? '')
  const retry = useRetryFailed(deck?.id ?? '')
  const update = useUpdateCard(deck?.id ?? '', id ?? '')
  const { start } = useGeneration()
  const [editing, setEditing] = useState(false)
  const c = query.data
  const lang = deck?.targetLang ?? ''
  const editable = c?.status === 'ready' || c?.status === 'suspended'

  return (
    <Screen
      title="Word"
      action={
        <Link to="/words" className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm font-medium text-zinc-500 underline dark:text-zinc-400">
          Back to words
        </Link>
      }
    >
      <ErrorText error={query.error ?? remove.error ?? retry.error ?? (editing ? null : update.error)} />
      {query.isPending && <p className={muted}>Loading…</p>}
      {c && editing && editable && (
        <EditForm
          card={c}
          saving={update.isPending}
          error={update.error}
          onCancel={() => setEditing(false)}
          onSave={(body) => update.mutate(body, { onSuccess: () => setEditing(false) })}
        />
      )}
      {c && !editing && (
        <>
          <section className={`${cardClass} flex flex-col gap-3`}>
            <div>
              <p className="text-3xl font-semibold tracking-tight">
                <Word text={c.display} lang={lang} />
              </p>
              {formsLine(c.content) && <p className={muted}>{formsLine(c.content)}</p>}
              {c.status === 'suspended' && (
                <p className={`mt-1 ${badgeBase} ${STATUS_BADGE.suspended.className}`} data-testid="suspended-badge">
                  Suspended · not shown in Learn or Train
                </p>
              )}
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
                {c.genError === 'not_a_word' ? `“${c.inputTerm}” was not recognised as a word.` : `${failedText(c.genError)}.`}
              </p>
            ) : null}
            {c.note && <p className="text-sm whitespace-pre-line">Note: {c.note}</p>}
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
              <p className={muted} data-testid="also-in-deck">
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

          {editable && (
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className={btnSecondary} onClick={() => setEditing(true)}>
                Edit
              </button>
              <button
                type="button"
                className={btnSecondary}
                disabled={update.isPending}
                onClick={() => update.mutate({ status: c.status === 'suspended' ? 'ready' : 'suspended' })}
              >
                {c.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
              </button>
            </div>
          )}
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

type EditBody = {
  translation: string | null
  exampleTarget: string | null
  exampleSource: string | null
  note: string | null
  extraTranslations: string[]
}

/** Edit what the card shows. An emptied field falls back to the generated content. */
function EditForm({
  card,
  saving,
  error,
  onCancel,
  onSave,
}: {
  card: CardDTO
  saving: boolean
  error: unknown
  onCancel: () => void
  onSave: (body: Partial<EditBody>) => void
}) {
  const [translation, setTranslation] = useState(card.translation ?? '')
  const [exampleTarget, setExampleTarget] = useState(card.content?.exampleTarget ?? '')
  const [exampleSource, setExampleSource] = useState(card.content?.exampleSource ?? '')
  const [note, setNote] = useState(card.note ?? '')
  const [extras, setExtras] = useState<string[]>(card.extraTranslations)
  const [extra, setExtra] = useState('')

  const addExtra = () => {
    const x = extra.trim()
    if (!x || extras.length >= MAX_EXTRA_TRANSLATIONS) return
    if (!extras.some((e) => e.toLowerCase() === x.toLowerCase())) setExtras([...extras, x])
    setExtra('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const pendingExtra = extra.trim()
    const all = pendingExtra && extras.length < MAX_EXTRA_TRANSLATIONS ? [...extras, pendingExtra] : extras
    // Only what changed: an untouched field keeps following the generated content.
    const body: Partial<EditBody> = {}
    if (translation.trim() !== (card.translation ?? '')) body.translation = translation
    if (exampleTarget.trim() !== (card.content?.exampleTarget ?? '')) body.exampleTarget = exampleTarget
    if (exampleSource.trim() !== (card.content?.exampleSource ?? '')) body.exampleSource = exampleSource
    if (note.trim() !== (card.note ?? '')) body.note = note
    if (JSON.stringify(all) !== JSON.stringify(card.extraTranslations)) body.extraTranslations = all
    if (Object.keys(body).length === 0) onCancel()
    else onSave(body)
  }

  return (
    <form onSubmit={submit} className={`${cardClass} flex flex-col gap-3`} aria-label="Edit word">
      <p className="text-xl font-semibold">{card.display}</p>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Translation</span>
        <input className={input} value={translation} maxLength={100} onChange={(e) => setTranslation(e.target.value)} />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Also means</legend>
        {extras.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {extras.map((x) => (
              <li key={x}>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1 rounded-full bg-zinc-100 px-4 text-sm dark:bg-zinc-900"
                  onClick={() => setExtras(extras.filter((e) => e !== x))}
                  aria-label={`Remove ${x}`}
                >
                  {x} <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {extras.length < MAX_EXTRA_TRANSLATIONS && (
          <div className="flex gap-2">
            <input
              className={input}
              value={extra}
              maxLength={100}
              aria-label="Add a translation"
              placeholder="Add a translation"
              onChange={(e) => setExtra(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addExtra()
                }
              }}
            />
            <button type="button" className={`${btnSmall} shrink-0`} onClick={addExtra} disabled={!extra.trim()}>
              Add
            </button>
          </div>
        )}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Example sentence</span>
        <textarea className={`${input} min-h-20`} value={exampleTarget} maxLength={300} onChange={(e) => setExampleTarget(e.target.value)} aria-describedby="marker-help" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Its translation</span>
        <textarea className={`${input} min-h-20`} value={exampleSource} maxLength={300} onChange={(e) => setExampleSource(e.target.value)} aria-describedby="marker-help" />
      </label>
      <p id="marker-help" className={muted}>
        Wrap the word in [[double brackets]] to highlight it. Without them the sentence is shown plain. Leave a field empty to restore the
        generated text.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Note</span>
        <textarea className={`${input} min-h-20`} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
      </label>
      <ErrorText error={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
