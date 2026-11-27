import { DEFAULT_TARGET, type LanguageCode } from '../../shared/languages'
import { useState, type FormEvent } from 'react'
import { useCurrentDeck } from '../lib/deck'
import { messages, useLanguageName, useT, useUiLang } from '../lib/i18n'
import { useCreateDeck, useLanguages } from '../lib/queries'
import { btnPrimary, ErrorText, input, muted } from './ui'

const M = messages(
  {
    name: 'Name',
    namePlaceholder: 'Deck name',
    learning: "I'm learning",
    fromLanguage: (lang: string) => `You learn from ${lang}, the app's language (change it in Settings → Language).`,
    creating: 'Creating…',
    create: 'Create deck',
  },
  {
    name: 'Nombre',
    namePlaceholder: 'Nombre del mazo',
    learning: 'Estoy aprendiendo',
    fromLanguage: (lang) => `Aprendes desde el ${lang}, el idioma de la app (cámbialo en Ajustes → Idioma).`,
    creating: 'Creando…',
    create: 'Crear mazo',
  },
)

/**
 * Minimal "new deck" form: name plus the language to learn. The source ("I speak") language is
 * the app language (docs/DECISIONS.md "App language").
 */
export function CreateDeckForm({ onCreated }: { onCreated?: () => void }) {
  const t = useT(M)
  const ui = useUiLang()
  const langName = useLanguageName()
  const languages = useLanguages()
  const create = useCreateDeck()
  const { selectDeck } = useCurrentDeck()
  const [name, setName] = useState('')
  const options = (languages.data?.languages ?? []).filter((l) => l.code !== ui)
  const [picked, setPicked] = useState<string>(DEFAULT_TARGET)
  const targetLang = options.some((l) => l.code === picked) ? picked : (options[0]?.code ?? DEFAULT_TARGET)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || targetLang === ui) return
    create.mutate(
      { name: name.trim(), sourceLang: ui, targetLang: targetLang as LanguageCode },
      {
        onSuccess: ({ deck }) => {
          selectDeck(deck.id)
          setName('')
          onCreated?.()
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.name}</span>
        <input className={input} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.learning}</span>
        <select className={input} value={targetLang} onChange={(e) => setPicked(e.target.value)}>
          {options.map((l) => (
            <option key={l.code} value={l.code}>
              {langName(l.code)}
            </option>
          ))}
        </select>
      </label>
      <p className={muted}>{t.fromLanguage(langName(ui))}</p>
      <ErrorText error={create.error ?? languages.error} />
      <button type="submit" className={btnPrimary} disabled={!name.trim() || create.isPending || !languages.data}>
        {create.isPending ? t.creating : t.create}
      </button>
    </form>
  )
}
