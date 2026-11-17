import { useState } from 'react'
import { CreateDeckForm } from '../components/CreateDeckForm'
import { btnSecondary, btnSmall, card, ErrorText, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { useDeleteDeck, useMe } from '../lib/queries'

/** Stub (M8 adds deck settings, theme, TTS and About): account, decks, new deck. */
export function Settings() {
  const me = useMe()
  const { decks } = useCurrentDeck()
  const remove = useDeleteDeck()
  const [creating, setCreating] = useState(false)

  return (
    <Screen title="Settings">
      <section className={card}>
        <h2 className={muted}>Signed in as</h2>
        <p className="mt-1 font-medium break-all">{me.data?.user.email ?? '…'}</p>
      </section>

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
