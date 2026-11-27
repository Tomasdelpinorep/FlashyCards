/** The colour themes and the pure rules of src/client/lib/theme.ts (no DOM, unit-tested). */
import type { UiLanguage } from '../../shared/languages'

export const THEME_KEY = 'flashy.theme.v1'

export type ThemeInfo = {
  id: string
  label: string
  /** Fixed light/dark, or null for System (follows the OS). */
  dark: boolean | null
  /** Page background (also <meta name="theme-color">) and the accent, for the swatch. */
  bg: string
  accent: string
}

export const THEMES = [
  { id: 'system', label: 'System', dark: null, bg: '#ffffff', accent: '#09090b' },
  { id: 'light', label: 'Light', dark: false, bg: '#ffffff', accent: '#18181b' },
  { id: 'dark', label: 'Dark', dark: true, bg: '#09090b', accent: '#f4f4f5' },
  { id: 'sepia', label: 'Sepia', dark: false, bg: '#f4ecd8', accent: '#7a4a24' },
  { id: 'solarized', label: 'Solarized Light', dark: false, bg: '#fdf6e3', accent: '#1f72ad' },
  { id: 'nord', label: 'Nord', dark: true, bg: '#2e3440', accent: '#88c0d0' },
  { id: 'dracula', label: 'Dracula', dark: true, bg: '#282a36', accent: '#bd93f9' },
  { id: 'betis', label: 'Real Betis Balompié', dark: false, bg: '#ffffff', accent: '#0bb363' },
] as const satisfies readonly ThemeInfo[]

export type ThemeId = (typeof THEMES)[number]['id']

/** Spanish labels for the themes with a descriptive name; named themes (Nord, Dracula, Betis) keep theirs. */
const ES_LABELS: Partial<Record<ThemeId, string>> = {
  system: 'Sistema',
  light: 'Claro',
  dark: 'Oscuro',
  sepia: 'Sepia',
  solarized: 'Solarized claro',
}

/** A theme's label in the app language (`label` in THEMES is the English one). */
export function themeLabel(id: ThemeId, ui: UiLanguage = 'en'): string {
  return (ui === 'es' ? ES_LABELS[id] : undefined) ?? byId(id).label
}

const byId = (id: ThemeId): ThemeInfo => THEMES.find((t) => t.id === id)!

/** A stored value back to a theme; anything unknown is System. */
export function parseTheme(value: unknown): ThemeId {
  return THEMES.some((t) => t.id === value) ? (value as ThemeId) : 'system'
}

/** Whether `theme` renders dark, given whether the OS prefers dark. */
export function isDarkTheme(theme: ThemeId, systemDark: boolean): boolean {
  return byId(theme).dark ?? systemDark
}

/** The page background of `theme` (used for <meta name="theme-color">). */
export function themeBackground(theme: ThemeId, systemDark: boolean): string {
  if (theme === 'system') return byId(systemDark ? 'dark' : 'light').bg
  return byId(theme).bg
}
