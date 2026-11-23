import { expect, expectAccessible, tapTargetSize, test } from './fixtures'

test.describe('settings', () => {
  test('study toggles persist across a reload', async ({ page, api, shot }) => {
    await page.goto('/settings')
    const tts = page.getByRole('switch', { name: /Read words aloud/ })
    const hide = page.getByRole('switch', { name: /Hide the sentence on the front/ })
    await expect(tts).not.toBeChecked()
    await expect(hide).not.toBeChecked()

    await tts.click()
    await expect(tts).toBeChecked()
    await expect.poll(async () => (await api.me()).user.settings.ttsAutoplay).toBe(true)
    await expect(hide).toBeEnabled()
    await hide.click()
    await expect.poll(async () => (await api.me()).user.settings.hideSentenceOnFront).toBe(true)
    await shot('settings-toggles')

    await page.reload()
    await expect(page.getByRole('switch', { name: /Read words aloud/ })).toBeChecked()
    await expect(page.getByRole('switch', { name: /Hide the sentence on the front/ })).toBeChecked()
    await expectAccessible(page, 'settings')

    const small = (await tapTargetSize(page, 'main button, main a, main label:has([role=switch])')).filter((b) => b.h < 44)
    expect(small).toEqual([])
  })

  test('About lists the word list attribution and the licences', async ({ page, shot }) => {
    await page.goto('/settings')
    await page.getByRole('link', { name: 'About and licences' }).click()
    await expect(page).toHaveURL(/\/about$/)
    const de = page.getByTestId('wordlist-de')
    await expect(de.getByRole('link', { name: /FrequencyWords by Hermit Dave/ })).toHaveAttribute('rel', /noopener/)
    await expect(de.getByRole('link', { name: 'CC-BY-SA-4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/')
    await expect(de).toContainText('OpenSubtitles 2018')
    await expect(page.getByText(/curated dictionary, written and checked by hand/)).toBeVisible()
    await expectAccessible(page, 'about')
    await shot('about')
  })

  test('Home links to the how-to guide, also linked from Settings', async ({ page, shot }) => {
    await page.goto('/')
    await expect(page.getByTestId('empty-deck')).toBeVisible()
    await page.getByRole('link', { name: 'How to use the app' }).click()
    await expect(page).toHaveURL(/\/how-to$/)
    await expect(page.getByRole('heading', { level: 1, name: 'How to use the app' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Train' })).toBeVisible()
    await expectAccessible(page, 'how-to')
    const small = (await tapTargetSize(page, 'main a')).filter((b) => b.h < 44)
    expect(small).toEqual([])
    await shot('how-to')

    await page.goto('/settings')
    await expect(page.getByRole('link', { name: 'How to use the app' })).toHaveAttribute('href', '/how-to')
  })

  test('the web app manifest is served', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest')
    expect(res.ok()).toBe(true)
    const manifest = (await res.json()) as { start_url: string; display: string; icons: { src: string }[] }
    expect(manifest).toMatchObject({ start_url: '/', display: 'standalone' })
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true)
  })
})
