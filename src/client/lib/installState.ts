/** The pure "Install app" rule of lib/install.ts (no DOM, unit-tested). */

export type InstallView =
  /** Running as the installed app, or nothing to offer: no install section. */
  | 'hidden'
  /** Chrome/Edge said the app can be installed: show the button (it opens the browser's dialog). */
  | 'button'
  /** iPhone/iPad Safari has no install event: explain Share → Add to Home Screen. */
  | 'ios-hint'

export function installView(s: { standalone: boolean; canPrompt: boolean; installed: boolean; ios: boolean }): InstallView {
  if (s.standalone || s.installed) return 'hidden'
  if (s.canPrompt) return 'button'
  return s.ios ? 'ios-hint' : 'hidden'
}

/** iPhone/iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}
