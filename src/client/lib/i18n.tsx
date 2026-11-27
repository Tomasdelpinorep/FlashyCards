/**
 * App text in the app language (docs/DECISIONS.md "App language"). No library: each screen or
 * component keeps its own messages next to its code, as an English object plus a Spanish one with
 * exactly the same keys (TypeScript checks this):
 *
 *   const M = messages({ title: 'Words', added: (n: number) => `${n} added` },
 *                      { title: 'Palabras', added: (n) => `${n} añadidas` })
 *   const t = useT(M)
 *   t.title; t.added(3)
 *
 * The language comes from the user's settings (`uiLang`); before /me has loaded (the loading
 * screen) it is the browser's language.
 */
import { DEFAULT_UI_LANGUAGE, languageName, uiLanguageFromPreferences, type UiLanguage } from '../../shared/languages'
import { useEffect } from 'react'
import { useMe } from './queries'

/** A message is a string, or a function for text with numbers or names in it. */
type Message = string | ((...args: any[]) => string)
export type Messages = Record<string, Message>

/** The Spanish side must have every English key, with the same kind of value. */
type Translation<T extends Messages> = { [K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => string : string }

export type MessageSet<T extends Messages> = Readonly<Record<UiLanguage, T>>

export function messages<T extends Messages>(en: T, es: Translation<T>): MessageSet<T> {
  return { en, es: es as unknown as T }
}

/** The browser's preferred app language (used until the account's setting is known). */
export function browserUiLanguage(): UiLanguage {
  if (typeof navigator === 'undefined') return DEFAULT_UI_LANGUAGE
  return uiLanguageFromPreferences(navigator.languages?.length ? navigator.languages : [navigator.language])
}

/** The current app language. */
export function useUiLang(): UiLanguage {
  const me = useMe()
  return me.data?.user.settings.uiLang ?? browserUiLanguage()
}

/** The messages of `set` in the current app language. */
export function useT<T extends Messages>(set: MessageSet<T>): T {
  return set[useUiLang()]
}

/** A language's name in the app language: useLanguageName()('de') -> "German" / "alemán". */
export function useLanguageName(): (code: string) => string {
  const ui = useUiLang()
  return (code) => languageName(code, ui)
}

/** Keeps <html lang> in step with the app language (screen readers, hyphenation, spell check). */
export function useDocumentLang(): void {
  const lang = useUiLang()
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
}
