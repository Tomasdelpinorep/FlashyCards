/**
 * The colour theme, chosen per device in Settings and stored in localStorage.
 *
 * <html> gets data-theme="<id>" and, for dark themes (and System on a dark OS), data-dark, which
 * the `dark:` variant follows (styles.css). public/theme-init.js applies the stored theme before
 * first paint with the same rules; keep THEME_KEY and the colours there in sync with this file.
 */
import { useSyncExternalStore } from 'react'
import { isDarkTheme, parseTheme, THEME_KEY, themeBackground, type ThemeId } from './themeInfo'

export { THEMES, type ThemeId } from './themeInfo'

export function loadTheme(): ThemeId {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return 'system'
  }
}

function saveTheme(theme: ThemeId) {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
  }
}

const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null)

/** Sets data-theme, data-dark and the theme-color meta on the document. */
export function applyTheme(theme: ThemeId, systemDark = darkQuery()?.matches ?? false) {
  const root = document.documentElement
  root.dataset.theme = theme
  if (isDarkTheme(theme, systemDark)) root.dataset.dark = ''
  else delete root.dataset.dark
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = themeBackground(theme, systemDark)
}

let current: ThemeId = 'system'
const listeners = new Set<() => void>()

/** Applies the stored theme and follows OS changes while System is chosen. Call once at startup. */
export function startTheme() {
  current = loadTheme()
  applyTheme(current)
  darkQuery()?.addEventListener('change', (e) => {
    if (current === 'system') applyTheme(current, e.matches)
  })
}

export function setTheme(theme: ThemeId) {
  current = theme
  saveTheme(theme)
  applyTheme(theme)
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** The current theme and a setter, for Settings. */
export function useTheme(): [ThemeId, (theme: ThemeId) => void] {
  return [useSyncExternalStore(subscribe, () => current), setTheme]
}
