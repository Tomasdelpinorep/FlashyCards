/**
 * "Install app" (Settings; docs/DECISIONS.md "Install button"). Chrome and Edge fire
 * `beforeinstallprompt` while the app can be installed (never once it is installed); the event is
 * kept so a button can open the browser's own install dialog later. `appinstalled` hides the
 * button; inside the installed app (display-mode standalone) there is nothing to offer. Safari on
 * iOS has no such event: Settings explains "Share → Add to Home Screen" instead.
 *
 * startInstallListener() runs at startup (main.tsx), because the event can fire before Settings
 * is ever opened.
 */
import { useSyncExternalStore } from 'react'
import { installView, isIos, type InstallView } from './installState'

/** Chrome's event (not in the TypeScript DOM types). */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
let view: InstallView = 'hidden'
const listeners = new Set<() => void>()

function standalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

function update() {
  const next = installView({ standalone: standalone(), canPrompt: deferred !== null, installed, ios: isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0) })
  if (next !== view) {
    view = next
    for (const l of listeners) l()
  }
}

let started = false
export function startInstallListener(): void {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('beforeinstallprompt', (e) => {
    // Our button replaces Chrome's own mini-bar.
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    update()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    update()
  })
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', update)
  update()
}

/** Opens the browser's install dialog. The event can be used once: Chrome sends a new one if declined. */
export async function promptInstall(): Promise<void> {
  const e = deferred
  if (!e) return
  deferred = null
  update()
  await e.prompt()
  await e.userChoice.catch(() => undefined)
}

function subscribe(listener: () => void) {
  startInstallListener()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useInstallView(): InstallView {
  return useSyncExternalStore(subscribe, () => view, () => 'hidden' as InstallView)
}
