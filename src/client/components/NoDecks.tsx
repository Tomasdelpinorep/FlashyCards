import { useState } from 'react'
import { messages, useT } from '../lib/i18n'
import { CreateDeckForm } from './CreateDeckForm'
import { btnPrimary, card, muted } from './ui'

const M = messages(
  {
    title: "You don't have any decks yet",
    body: "A deck holds the words you're learning in one language.",
    create: 'Create a deck',
  },
  {
    title: 'Todavía no tienes ningún mazo',
    body: 'Un mazo guarda las palabras que estás aprendiendo en un idioma.',
    create: 'Crear un mazo',
  },
)

/** Empty state for a user with zero decks. */
export function NoDecks() {
  const t = useT(M)
  const [open, setOpen] = useState(false)
  return (
    <section className={`${card} flex flex-col gap-4`}>
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className={`${muted} mt-1`}>{t.body}</p>
      </div>
      {open ? (
        <CreateDeckForm />
      ) : (
        <button type="button" className={btnPrimary} onClick={() => setOpen(true)}>
          {t.create}
        </button>
      )}
    </section>
  )
}
