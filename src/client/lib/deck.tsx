/** The deck the user is working in. Remembered per browser (a convenience only). */
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { DeckDTO } from '../../shared/schemas'

const STORAGE_KEY = 'flashcards.deckId'

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

type DeckContextValue = { deck: DeckDTO | undefined; decks: DeckDTO[]; selectDeck: (id: string) => void }

const DeckContext = createContext<DeckContextValue>({ deck: undefined, decks: [], selectDeck: () => {} })

export function DeckProvider({ decks, children }: { decks: DeckDTO[]; children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(readStored)
  const deck = decks.find((d) => d.id === selected) ?? decks[0]
  const selectDeck = (id: string) => {
    setSelected(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // storage unavailable: the choice just isn't remembered
    }
  }
  return <DeckContext.Provider value={{ deck, decks, selectDeck }}>{children}</DeckContext.Provider>
}

export function useCurrentDeck() {
  return useContext(DeckContext)
}
