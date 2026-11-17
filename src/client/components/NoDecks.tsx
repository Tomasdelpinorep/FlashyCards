import { useState } from 'react'
import { CreateDeckForm } from './CreateDeckForm'
import { btnPrimary, card, muted } from './ui'

/** Empty state for a user with zero decks. */
export function NoDecks() {
  const [open, setOpen] = useState(false)
  return (
    <section className={`${card} flex flex-col gap-4`}>
      <div>
        <h2 className="text-lg font-semibold">You don't have any decks yet</h2>
        <p className={`${muted} mt-1`}>A deck holds the words you're learning in one language.</p>
      </div>
      {open ? (
        <CreateDeckForm />
      ) : (
        <button type="button" className={btnPrimary} onClick={() => setOpen(true)}>
          Create a deck
        </button>
      )}
    </section>
  )
}
