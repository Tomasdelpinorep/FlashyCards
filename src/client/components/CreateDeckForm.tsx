import { DEFAULT_SOURCE, DEFAULT_TARGET, type LanguageCode } from '../../shared/languages'
import { useState, type FormEvent } from 'react'
import { useCurrentDeck } from '../lib/deck'
import { useCreateDeck, useLanguages } from '../lib/queries'
import { btnPrimary, ErrorText, input, muted } from './ui'

/** Minimal "new deck" form: name plus source and target language from /api/languages. */
export function CreateDeckForm({ onCreated }: { onCreated?: () => void }) {
  const languages = useLanguages()
  const create = useCreateDeck()
  const { selectDeck } = useCurrentDeck()
  const [name, setName] = useState('')
  const [sourceLang, setSourceLang] = useState<string>(DEFAULT_SOURCE)
  const [targetLang, setTargetLang] = useState<string>(DEFAULT_TARGET)
  const same = sourceLang === targetLang

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || same) return
    create.mutate(
      { name: name.trim(), sourceLang: sourceLang as LanguageCode, targetLang: targetLang as LanguageCode },
      {
        onSuccess: ({ deck }) => {
          selectDeck(deck.id)
          setName('')
          onCreated?.()
        },
      },
    )
  }

  const options = languages.data?.languages ?? []
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Name</span>
        <input className={input} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Deck name" required />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">I speak</span>
          <select className={input} value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
            {options.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">I'm learning</span>
          <select className={input} value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
            {options.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {same && <p className={muted}>Pick two different languages.</p>}
      <p className={muted}>The language pair can't be changed later.</p>
      <ErrorText error={create.error ?? languages.error} />
      <button type="submit" className={btnPrimary} disabled={!name.trim() || same || create.isPending || !languages.data}>
        {create.isPending ? 'Creating…' : 'Create deck'}
      </button>
    </form>
  )
}
