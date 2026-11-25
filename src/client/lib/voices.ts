/** Picking the best speechSynthesis voice for a language (pure; used by lib/tts.ts). */

export type VoiceLike = { lang: string; name: string; localService: boolean }

function normLang(l: string): string {
  return l.replace(/_/g, '-').toLowerCase()
}

function tier(v: VoiceLike): number {
  if (/natural|online/i.test(v.name)) return 0 // Edge neural voices
  if (/google/i.test(v.name)) return 1 // Chrome's "Google Deutsch"
  if (!v.localService) return 2
  return 3
}

/**
 * The voices for `lang` (a BCP 47 tag; 'de_DE' forms accepted on both sides), best first:
 * an exact match before the same base language, then neural ("Natural"/"Online"), Google,
 * network, any. Voices of other languages are left out.
 */
export function rankVoices<V extends VoiceLike>(voices: readonly V[], lang: string): V[] {
  const want = normLang(lang)
  const base = want.split('-')[0]!
  const scored: { v: V; exact: number; tier: number; i: number }[] = []
  voices.forEach((v, i) => {
    const l = normLang(v.lang)
    if (l === want) scored.push({ v, exact: 0, tier: tier(v), i })
    else if (l.split('-')[0] === base) scored.push({ v, exact: 1, tier: tier(v), i })
  })
  scored.sort((a, b) => a.exact - b.exact || a.tier - b.tier || a.i - b.i)
  return scored.map((s) => s.v)
}
