import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isDarkTheme, parseTheme, THEME_KEY, themeBackground, THEMES } from '../../src/client/lib/themeInfo'

describe('theme', () => {
  it('parses stored values, falling back to System', () => {
    expect(parseTheme('nord')).toBe('nord')
    expect(parseTheme('solarized')).toBe('solarized')
    expect(parseTheme(null)).toBe('system')
    expect(parseTheme('neon')).toBe('system')
    expect(parseTheme(42)).toBe('system')
  })

  it('System follows the OS; the others are fixed', () => {
    expect(isDarkTheme('system', true)).toBe(true)
    expect(isDarkTheme('system', false)).toBe(false)
    for (const id of ['dark', 'nord', 'dracula'] as const) expect(isDarkTheme(id, false)).toBe(true)
    for (const id of ['light', 'sepia', 'solarized'] as const) expect(isDarkTheme(id, true)).toBe(false)
  })

  it('gives the page background for theme-color', () => {
    expect(themeBackground('system', false)).toBe('#ffffff')
    expect(themeBackground('system', true)).toBe('#09090b')
    expect(themeBackground('nord', false)).toBe('#2e3440')
    expect(themeBackground('sepia', true)).toBe('#f4ecd8')
  })

  it('public/theme-init.js uses the same key, dark themes and backgrounds', () => {
    const js = readFileSync('public/theme-init.js', 'utf8')
    expect(js).toContain(`'${THEME_KEY}'`)
    for (const t of THEMES) {
      if (t.id === 'system') continue
      expect(js).toContain(`${t.id}: '${t.bg}'`)
      expect(new RegExp(`darkThemes = \\{[^}]*\\b${t.id}: 1`).test(js)).toBe(t.dark)
    }
  })
})
