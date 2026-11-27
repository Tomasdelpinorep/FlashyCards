import { Link } from 'react-router'
import { LANGUAGES } from '../../shared/languages'
import { card, muted, Screen } from '../components/ui'
import { messages, useLanguageName, useT } from '../lib/i18n'

const M = messages(
  {
    title: 'About',
    settings: 'Settings',
    appName: 'FlashyCards',
    licenseBefore: "A spaced-repetition vocabulary app. The app's source code is released under the",
    licenseAfter: '.',
    dictionary:
      'Translations and example sentences come from a curated dictionary, written and checked by hand. Words you add yourself use the meaning you enter. You can correct any word from its page in Words.',
    wordLists: 'Word lists',
    noLists: 'No bundled word lists.',
  },
  {
    title: 'Acerca de',
    settings: 'Ajustes',
    appName: 'FlashyCards',
    licenseBefore: 'Una app de vocabulario con repetición espaciada. El código fuente de la app se publica bajo la',
    licenseAfter: '.',
    dictionary:
      'Las traducciones y las frases de ejemplo vienen de un diccionario seleccionado, escrito y revisado a mano. Las palabras que añades tú usan el significado que escribes. Puedes corregir cualquier palabra desde su página en Palabras.',
    wordLists: 'Listas de palabras',
    noLists: 'No hay listas de palabras incluidas.',
  },
)

const REPO_LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0'
const external = { target: '_blank', rel: 'noopener noreferrer' } as const
const linkClass = 'underline underline-offset-2'

/** Credits: the bundled word lists (attribution required by their licences), the app licence, the dictionary. */
export function About() {
  const t = useT(M)
  const languageName = useLanguageName()
  const lists = Object.values(LANGUAGES).filter((l) => l.wordlist)
  return (
    <Screen
      title={t.title}
      action={
        <Link to="/settings" className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm font-medium text-zinc-500 underline dark:text-zinc-400">
          {t.settings}
        </Link>
      }
    >
      <section className={`${card} flex flex-col gap-2`}>
        <h2 className="font-semibold">{t.appName}</h2>
        <p className="text-sm">
          {t.licenseBefore}{' '}
          <a className={linkClass} href={REPO_LICENSE_URL} {...external}>
            Apache License 2.0
          </a>
          {t.licenseAfter}
        </p>
        <p className="text-sm">{t.dictionary}</p>
      </section>

      <section className={`${card} flex flex-col gap-3`}>
        <h2 className="font-semibold">{t.wordLists}</h2>
        {lists.length === 0 && <p className={muted}>{t.noLists}</p>}
        {lists.map((l) => (
          <div key={l.code} className="flex flex-col gap-1" data-testid={`wordlist-${l.code}`}>
            <h3 className="text-sm font-medium">{languageName(l.code)}</h3>
            <p className="text-sm">
              <a className={linkClass} href={l.wordlist!.url} {...external}>
                {l.wordlist!.name}
              </a>{' '}
              ·{' '}
              <a className={linkClass} href={l.wordlist!.licenseUrl} {...external}>
                {l.wordlist!.license}
              </a>
            </p>
            <p className={muted}>{l.wordlist!.attribution}</p>
          </div>
        ))}
      </section>
    </Screen>
  )
}
