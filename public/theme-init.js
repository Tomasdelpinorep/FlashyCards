// Applies the saved colour theme before first paint (no flash). Mirrors src/client/lib/theme.ts:
// keep the key, the theme ids and the backgrounds in sync with it.
;(function () {
  var bg = { light: '#ffffff', dark: '#09090b', sepia: '#f4ecd8', solarized: '#fdf6e3', nord: '#2e3440', dracula: '#282a36' }
  var darkThemes = { dark: 1, nord: 1, dracula: 1 }
  var theme = 'system'
  try {
    var saved = localStorage.getItem('flashy.theme.v1')
    if (saved && bg[saved]) theme = saved
  } catch (e) {}
  var systemDark = false
  try {
    systemDark = matchMedia('(prefers-color-scheme: dark)').matches
  } catch (e) {}
  var dark = theme === 'system' ? systemDark : !!darkThemes[theme]
  var root = document.documentElement
  root.setAttribute('data-theme', theme)
  if (dark) root.setAttribute('data-dark', '')
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'system' ? (dark ? bg.dark : bg.light) : bg[theme])
})()
