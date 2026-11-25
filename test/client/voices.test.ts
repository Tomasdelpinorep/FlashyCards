import { describe, expect, it } from 'vitest'
import { rankVoices, type VoiceLike } from '../../src/client/lib/voices'

const v = (name: string, lang: string, localService = true): VoiceLike => ({ name, lang, localService })

describe('rankVoices', () => {
  it('leaves out other languages, so an English voice never reads German', () => {
    expect(rankVoices([v('Microsoft David', 'en-US'), v('Microsoft Zira', 'en-US')], 'de-DE')).toEqual([])
  })
  it('puts an exact match before the same base language, case- and underscore-insensitive', () => {
    const at = v('Microsoft Michael', 'de-AT')
    const de = v('Anna', 'de_de')
    expect(rankVoices([at, de], 'de-DE')).toEqual([de, at])
  })
  it('prefers Natural/Online voices, then Google, then network, then local', () => {
    const local = v('Microsoft Hedda', 'de-DE')
    const network = v('Some Cloud', 'de-DE', false)
    const google = v('Google Deutsch', 'de-DE', false)
    const natural = v('Microsoft Katja Online (Natural) - German (Germany)', 'de-DE', false)
    const en = v('Google US English', 'en-US', false)
    expect(rankVoices([local, en, network, google, natural], 'de-DE')).toEqual([natural, google, network, local])
  })
  it('keeps the browser order among equal voices', () => {
    const a = v('A', 'de-DE')
    const b = v('B', 'de-DE')
    expect(rankVoices([a, b], 'de-DE')).toEqual([a, b])
  })
})
