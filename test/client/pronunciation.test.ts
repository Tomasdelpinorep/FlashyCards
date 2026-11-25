import { describe, expect, it } from 'vitest'
import { pronunciationVideoUrl } from '../../src/client/lib/pronunciation'

describe('pronunciationVideoUrl', () => {
  it('German words (with the article) get the "German Pronunciation" search', () => {
    expect(pronunciationVideoUrl('der Hund', 'de')).toBe(
      'https://www.youtube.com/results?search_query=how%20to%20pronounce%20der%20Hund%20German%20Pronunciation',
    )
  })
  it('other languages use the language name, and encode special characters', () => {
    expect(pronunciationVideoUrl('el niño', 'es')).toBe('https://www.youtube.com/results?search_query=how%20to%20pronounce%20el%20ni%C3%B1o%20Spanish')
    expect(pronunciationVideoUrl('Straße & Co', 'de')).toContain('Stra%C3%9Fe%20%26%20Co')
  })
})
