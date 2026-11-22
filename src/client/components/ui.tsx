/** Small shared UI pieces and class names (mobile-first, light and dark). */
import type { ReactNode } from 'react'
import { articleColor, highlightSegments } from '../../shared/display'

export const btnPrimary =
  'inline-flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 font-medium text-white active:scale-[0.99] disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900'
export const btnSecondary =
  'inline-flex h-12 w-full items-center justify-center rounded-xl border border-zinc-300 px-4 font-medium active:scale-[0.99] disabled:opacity-40 dark:border-zinc-700'
export const btnSmall =
  'inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 px-3 text-sm font-medium disabled:opacity-40 dark:border-zinc-700'
export const input =
  'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100'
export const card = 'rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800'
export const muted = 'text-sm text-zinc-500 dark:text-zinc-400'

export function Screen({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-h-11 items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {action}
      </header>
      {children}
    </div>
  )
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}

const ARTICLE_COLORS = {
  blue: 'text-blue-600 dark:text-blue-400',
  red: 'text-red-600 dark:text-red-400',
  green: 'text-green-600 dark:text-green-400',
} as const

/** A word with its leading article coloured by gender (der blue, die red, das green). */
export function Word({ text, lang }: { text: string; lang: string }) {
  const parts = articleColor(lang, text)
  if (!parts) return <>{text}</>
  return (
    <>
      <span className={ARTICLE_COLORS[parts.color]}>{parts.article}</span>
      {parts.rest}
    </>
  )
}

/** A sentence with its [[ ]] parts highlighted (shown plain when the markers are missing). */
export function Sentence({ text, className = '' }: { text: string | null | undefined; className?: string }) {
  const segments = highlightSegments(text)
  if (segments.length === 0) return null
  return (
    <p className={className}>
      {segments.map((s, i) =>
        s.mark ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 font-semibold text-inherit dark:bg-amber-900/60">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  )
}
