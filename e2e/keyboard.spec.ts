import { expect, test } from './fixtures'

/**
 * The on-screen keyboard can't be opened in a test browser. Chrome on Android (with
 * interactive-widget=resizes-content) shrinks the page when it opens, so the test does the same:
 * focus the answer box, then shrink the viewport to what a phone leaves above the keyboard.
 */
test.describe('typing on a phone', () => {
  test('the word stays visible above the answer box while the keyboard is open', async ({ page, api, deck, shot }) => {
    const [hund] = await api.readyCards(deck.id, 'Hund')
    await api.review(hund!.id, 1)

    await page.goto('/train')
    const box = page.getByRole('textbox')
    await expect(box).toBeVisible()
    const full = page.viewportSize()!
    await box.focus()
    await page.setViewportSize({ width: full.width, height: 430 })

    const word = page.getByTestId('study-card').getByText('Hund', { exact: false }).first()
    await expect(word).toBeInViewport()
    await expect(box).toBeInViewport()
    await expect(page.getByRole('navigation')).toHaveCount(0) // the tab bar steps aside
    await expect(page.getByRole('radiogroup')).toBeHidden() // direction tabs too
    // The word is above the box, both inside the visible 430 px.
    const w = (await word.boundingBox())!
    const b = (await box.boundingBox())!
    expect(w.y).toBeGreaterThanOrEqual(0)
    expect(w.y + w.height).toBeLessThan(b.y)
    expect(b.y + b.height).toBeLessThanOrEqual(430)
    await shot('keyboard-open-train', { fullPage: false })

    // Keyboard closed again: the normal layout comes back.
    await page.setViewportSize(full)
    await box.blur()
    await expect(page.getByRole('navigation')).toBeVisible()
    await expect(page.getByRole('radiogroup')).toBeVisible()
  })
})
