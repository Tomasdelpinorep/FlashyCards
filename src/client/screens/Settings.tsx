import { useState } from 'react'
import { CreateDeckForm } from '../components/CreateDeckForm'
import type { DeckDTO } from '../../shared/schemas'
import { btnSecondary, btnSmall, card, ErrorText, input, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useDeleteDeck, useMe, useUpdateDeck } from '../lib/queries'

/** Stub (M8 adds the other deck settings, theme, TTS and About): account, skipTopN, decks, new deck. */
export function Settings() {
  const me = useMe()
  const { deck, decks } = useCurrentDeck()
  const remove = useDeleteDeck()
  const [creating, setCreating] = useState(false)

  return (
    <Screen title="Settings">
      <section className={card}>
        <h2 className={muted}>Signed in as</h2>
        <p className="mt-1 font-medium break-all">{me.data?.user.email ?? '…'}</p>
      </section>

      {deck && <DeckSettingsForm key={deck.id} deck={deck} />}

      <section className={`${card} flex flex-col gap-3`}>
        <h2 className="font-semibold">Decks</h2>
        {decks.length === 0 && <p className={muted}>You don't have any decks yet.</p>}
        <ul className="flex flex-col gap-2">
          {decks.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
              <span className="min-w-0">
                <span className="block truncate font-medium">{d.name}</span>
                <span className={`${muted} uppercase`}>
                  {d.sourceLang} → {d.targetLang}
                </span>
              </span>
              <button
                type="button"
                className={btnSmall}
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Delete the deck “${d.name}” and all its words? This can't be undone.`)) remove.mutate(d.id)
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <ErrorText error={remove.error} />
        {creating ? (
          <CreateDeckForm onCreated={() => setCreating(false)} />
        ) : (
          <button type="button" className={btnSecondary} onClick={() => setCreating(true)}>
            New deck
          </button>
        )}
      </section>
    </Screen>
  )
}

const SKIP_TOP_MAX = 50_000

/** Settings of the current deck (M7: skipTopN; M8 adds the rest). */
function DeckSettingsForm({ deck }: { deck: DeckDTO }) {
  const update = useUpdateDeck(deck.id)
  const [skip, setSkip] = useState(String(deck.settings.skipTopN))
  const n = Number(skip)
  const valid = skip.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= SKIP_TOP_MAX
  const changed = valid && n !== deck.settings.skipTopN

  return (
    <section className={`${card} flex flex-col gap-3`}>
      <h2 className="font-semibold">{deck.name}</h2>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (changed) update.mutate({ settings: { skipTopN: n } })
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Skip the N most common words</span>
          <input
            className={input}
            type="number"
            inputMode="numeric"
            min={0}
            max={SKIP_TOP_MAX}
            value={skip}
            onChange={(e) => setSkip(e.target.value)}
            aria-describedby="skip-help"
          />
        </label>
        <p id="skip-help" className={muted}>
          “Add new words” starts after this many of the most frequent words. Use it if you already know the basics.
        </p>
        <button type="submit" className={btnSmall} disabled={!changed || update.isPending}>
          {update.isPending ? 'Saving…' : update.isSuccess && !changed ? 'Saved' : 'Save'}
        </button>
        <ErrorText error={update.error} />
      </form>
    </section>
  )
}
