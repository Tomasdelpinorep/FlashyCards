import { useState } from 'react'
import { Link } from 'react-router'
import { CreateDeckForm } from '../components/CreateDeckForm'
import type { DeckDTO, UserSettings } from '../../shared/schemas'
import { btnSecondary, btnSmall, card, ErrorText, input, muted, Screen } from '../components/ui'
import { useCurrentDeck } from '../lib/deck'
import { THEMES, useTheme } from '../lib/theme'
import { themeLabel } from '../lib/themeInfo'
import { useDeleteDeck, useMe, useUpdateDeck, useUpdateMe } from '../lib/queries'
import { useLanguageName, useT, useUiLang, messages } from '../lib/i18n'
import { UI_LANGUAGES, type UiLanguage } from '../../shared/languages'

const M = messages(
  {
    title: 'Settings',
    signedInAs: 'Signed in as',
    decks: 'Decks',
    noDecks: "You don't have any decks yet.",
    confirmDelete: (name: string) => `Delete the deck “${name}” and all its words? This can't be undone.`,
    delete: 'Delete',
    newDeck: 'New deck',
    howTo: 'How to use the app',
    about: 'About and licences',
    study: 'Study',
    readAloud: 'Read words aloud',
    readAloudHelp: 'Speak the word and sentence automatically when a card is shown.',
    hideSentence: 'Hide the sentence on the front',
    hideSentenceHelp: 'Show only the word until you reveal the answer.',
    theme: 'Theme',
    themeHelp: "System follows your device's light or dark mode. Saved on this device only.",
    skipTop: 'Skip the N most common words',
    skipTopHelp: '“Add new words” starts after this many of the most frequent words. Use it if you already know the basics.',
    saving: 'Saving…',
    saved: 'Saved',
    save: 'Save',
    language: 'Language',
    languageHelp:
      'The app’s language is also the language you learn from: your decks switch to its meanings. Your words and progress are kept, and meanings you typed yourself stay as you typed them.',
    switching: 'Switching…',
  },
  {
    title: 'Ajustes',
    signedInAs: 'Has iniciado sesión como',
    decks: 'Mazos',
    noDecks: 'Todavía no tienes ningún mazo.',
    confirmDelete: (name) => `¿Borrar el mazo “${name}” y todas sus palabras? No se puede deshacer.`,
    delete: 'Borrar',
    newDeck: 'Nuevo mazo',
    howTo: 'Cómo se usa la app',
    about: 'Acerca de y licencias',
    study: 'Estudio',
    readAloud: 'Leer las palabras en voz alta',
    readAloudHelp: 'Pronuncia la palabra y la frase automáticamente al mostrar una tarjeta.',
    hideSentence: 'Ocultar la frase en el anverso',
    hideSentenceHelp: 'Muestra solo la palabra hasta que veas la respuesta.',
    theme: 'Tema',
    themeHelp: 'Sistema sigue el modo claro u oscuro de tu dispositivo. Se guarda solo en este dispositivo.',
    skipTop: 'Saltar las N palabras más comunes',
    skipTopHelp: '“Añadir palabras” empieza después de este número de palabras más frecuentes. Úsalo si ya sabes lo básico.',
    saving: 'Guardando…',
    saved: 'Guardado',
    save: 'Guardar',
    language: 'Idioma',
    languageHelp:
      'El idioma de la app es también el idioma desde el que aprendes: tus mazos pasan a sus significados. Tus palabras y tu progreso se conservan, y los significados que escribiste tú se quedan como los escribiste.',
    switching: 'Cambiando…',
  },
)

/** Each app language in its own name, so anyone can find theirs. */
const OWN_NAMES: Record<UiLanguage, string> = { en: 'English', es: 'Español' }

/** Account, study preferences, the current deck's settings, decks, new deck, About. */
export function Settings() {
  const me = useMe()
  const { deck, decks } = useCurrentDeck()
  const remove = useDeleteDeck()
  const [creating, setCreating] = useState(false)
  const t = useT(M)
  const langName = useLanguageName()

  return (
    <Screen title={t.title}>
      <LanguagePicker />

      <section className={card}>
        <h2 className={muted}>{t.signedInAs}</h2>
        <p className="mt-1 font-medium break-all">{me.data?.user.email ?? '…'}</p>
      </section>

      {me.data && <StudyToggles settings={me.data.user.settings} />}

      <ThemePicker />

      {deck && <DeckSettingsForm key={deck.id} deck={deck} />}

      <section className={`${card} flex flex-col gap-3`}>
        <h2 className="font-semibold">{t.decks}</h2>
        {decks.length === 0 && <p className={muted}>{t.noDecks}</p>}
        <ul className="flex flex-col gap-2">
          {decks.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
              <span className="min-w-0">
                <span className="block truncate font-medium">{d.name}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {langName(d.sourceLang)} → {langName(d.targetLang)}
                </span>
              </span>
              <button
                type="button"
                className={btnSmall}
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(t.confirmDelete(d.name))) remove.mutate(d.id)
                }}
              >
                {t.delete}
              </button>
            </li>
          ))}
        </ul>
        <ErrorText error={remove.error} />
        {creating ? (
          <CreateDeckForm onCreated={() => setCreating(false)} />
        ) : (
          <button type="button" className={btnSecondary} onClick={() => setCreating(true)}>
            {t.newDeck}
          </button>
        )}
      </section>

      <Link to="/how-to" className={btnSecondary}>
        {t.howTo}
      </Link>
      <Link to="/about" className={btnSecondary}>
        {t.about}
      </Link>
    </Screen>
  )
}

type ToggleKey = 'ttsAutoplay' | 'hideSentenceOnFront'

const TOGGLES: { key: ToggleKey; label: 'readAloud' | 'hideSentence'; help: 'readAloudHelp' | 'hideSentenceHelp' }[] = [
  { key: 'ttsAutoplay', label: 'readAloud', help: 'readAloudHelp' },
  { key: 'hideSentenceOnFront', label: 'hideSentence', help: 'hideSentenceHelp' },
]

/**
 * The app language (stored in the account). Switching converts the decks on the server
 * (services/switchLanguage.ts), then every screen refetches.
 */
function LanguagePicker() {
  const t = useT(M)
  const current = useUiLang()
  const update = useUpdateMe()
  const shown = update.isPending ? (update.variables?.settings?.uiLang ?? current) : current
  return (
    <section className={card}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">
          {t.language}
          {update.isPending && <span className={`ml-2 font-normal ${muted}`}>{t.switching}</span>}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {UI_LANGUAGES.map((code) => (
            <label
              key={code}
              lang={code}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-zinc-300 px-3 py-2 text-sm font-medium has-checked:border-accent has-checked:ring-1 has-checked:ring-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:opacity-50 dark:border-zinc-700"
            >
              <input
                type="radio"
                name="uiLang"
                value={code}
                className="sr-only"
                checked={shown === code}
                disabled={update.isPending}
                onChange={() => update.mutate({ settings: { uiLang: code } })}
              />
              {OWN_NAMES[code]}
            </label>
          ))}
        </div>
        <p className={muted}>{t.languageHelp}</p>
        <ErrorText error={update.error} />
      </fieldset>
    </section>
  )
}

/** Switches stored in the user's settings (PATCH /me merges partial settings). Disabled while saving. */
function StudyToggles({ settings }: { settings: UserSettings }) {
  const t = useT(M)
  const update = useUpdateMe()
  return (
    <section className={`${card} flex flex-col gap-1`}>
      <h2 className="mb-1 font-semibold">{t.study}</h2>
      {TOGGLES.map((tg) => {
        // While saving, show the value being saved (optimistic).
        const saving = update.isPending && update.variables?.settings?.[tg.key] !== undefined
        const checked = saving ? !!update.variables?.settings?.[tg.key] : settings[tg.key]
        return (
          <label key={tg.key} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-1">
            <span className="min-w-0">
              <span className="block font-medium">{t[tg.label]}</span>
              <span className={`block ${muted}`}>{t[tg.help]}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-zinc-300 transition-colors before:block before:h-5 before:w-5 before:translate-x-0.5 before:rounded-full before:bg-white before:shadow before:transition-transform checked:bg-accent checked:before:translate-x-5.5 disabled:opacity-50 dark:bg-zinc-700 dark:before:bg-zinc-900 dark:checked:before:bg-zinc-900"
              checked={checked}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ settings: { [tg.key]: e.target.checked } })}
            />
          </label>
        )
      })}
      <ErrorText error={update.error} />
    </section>
  )
}

/** The colour theme of this device (stored locally, not in the account). */
function ThemePicker() {
  const tr = useT(M)
  const ui = useUiLang()
  const [theme, setTheme] = useTheme()
  return (
    <section className={card}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{tr.theme}</legend>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((t) => (
            <label
              key={t.id}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-zinc-300 px-3 py-2 text-sm font-medium has-checked:border-accent has-checked:ring-1 has-checked:ring-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent dark:border-zinc-700"
            >
              <input
                type="radio"
                name="theme"
                value={t.id}
                className="sr-only"
                checked={theme === t.id}
                onChange={() => setTheme(t.id)}
              />
              <span
                aria-hidden="true"
                className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full border border-zinc-400"
                style={{
                  background: t.id === 'system' ? 'linear-gradient(135deg, #ffffff 50%, #09090b 50%)' : t.bg,
                }}
              >
                {t.id !== 'system' && (
                  <span className="absolute right-0.5 bottom-0.5 h-2.5 w-2.5 rounded-full" style={{ background: t.accent }} />
                )}
              </span>
              <span className="min-w-0">{themeLabel(t.id, ui)}</span>
            </label>
          ))}
        </div>
        <p className={muted}>{tr.themeHelp}</p>
      </fieldset>
    </section>
  )
}

const SKIP_TOP_MAX = 50_000

/** Settings of the current deck (M7: skipTopN; M8 adds the rest). */
function DeckSettingsForm({ deck }: { deck: DeckDTO }) {
  const t = useT(M)
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
          <span className="text-sm font-medium">{t.skipTop}</span>
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
          {t.skipTopHelp}
        </p>
        <button type="submit" className={btnSmall} disabled={!changed || update.isPending}>
          {update.isPending ? t.saving : update.isSuccess && !changed ? t.saved : t.save}
        </button>
        <ErrorText error={update.error} />
      </form>
    </section>
  )
}
