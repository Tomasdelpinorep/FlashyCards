import { expect, expectAccessible, test } from './fixtures'

test.describe('app language', () => {
  test('switching to Español translates the app and the deck, keeping words and progress', async ({ page, api, deck, shot }) => {
    const [hund] = await api.readyCards(deck.id, 'Hund')
    await api.review(hund!.id, 3)
    const before = (await api.cards(deck.id)).cards.find((c) => c.id === hund!.id)!

    await page.goto('/settings')
    await page.getByText('Español', { exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByText('español → alemán')).toBeVisible()
    await expectAccessible(page, 'settings in Spanish')
    await shot('language-settings-es')

    const me = await api.me()
    expect(me.user.settings.uiLang).toBe('es')
    expect(me.decks).toHaveLength(1)
    expect(me.decks[0]).toMatchObject({ id: deck.id, name: 'Alemán', sourceLang: 'es', targetLang: 'de' })
    const after = (await api.cards(deck.id)).cards.find((c) => c.id === hund!.id)!
    expect(after.translation).toBe('perro')
    expect(after.srs).toEqual(before.srs)

    await page.goto('/words')
    await expect(page.getByRole('listitem').filter({ hasText: 'der Hund' })).toContainText('perro')
    await expectAccessible(page, 'words in Spanish')
    await shot('language-words-es')

    await page.goto('/')
    await expectAccessible(page, 'home in Spanish')
    await shot('language-home-es')

    await page.goto('/how-to')
    await expect(page.getByRole('heading', { level: 2, name: 'Idioma' })).toBeVisible()

    // And back: English text and meanings again.
    await page.goto('/settings')
    await page.getByText('English', { exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    expect((await api.cards(deck.id)).cards.find((c) => c.id === hund!.id)!.translation).toBe('dog')
  })

  test('a new deck learns from the app language', async ({ page, api }) => {
    await api.updateSettings({ uiLang: 'es' })
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Nuevo mazo' }).click()
    await page.getByLabel('Nombre', { exact: true }).fill('Mi alemán')
    await expect(page.getByLabel('Estoy aprendiendo')).toHaveValue('de')
    await page.getByRole('button', { name: 'Crear mazo' }).click()
    await expect.poll(async () => (await api.me()).decks.map((d) => [d.name, d.sourceLang, d.targetLang])).toContainEqual(['Mi alemán', 'es', 'de'])
  })
})
