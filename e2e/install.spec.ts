import { expect, expectAccessible, test } from './fixtures'

/**
 * Chrome decides by itself when to fire `beforeinstallprompt` (never in a test browser), so the
 * test fires a stand-in with the same shape and checks the button uses it.
 */
test.describe('install app', () => {
  test('no install section when the browser offers nothing', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(page.getByTestId('install-app')).toHaveCount(0)
  })

  test('the button opens the browser’s install dialog and disappears once installed', async ({ page, shot }) => {
    await page.goto('/settings')
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>
      ;(window as unknown as { prompted: number }).prompted = 0
      e.prompt = () => {
        ;(window as unknown as { prompted: number }).prompted++
        return Promise.resolve()
      }
      e.userChoice = Promise.resolve({ outcome: 'accepted' })
      window.dispatchEvent(e)
    })
    const button = page.getByRole('button', { name: 'Install app' })
    await expect(button).toBeVisible()
    await expectAccessible(page, 'settings with the install button')
    await shot('settings-install', { fullPage: false })
    await button.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { prompted: number }).prompted)).toBe(1)
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await expect(page.getByTestId('install-app')).toHaveCount(0)
  })
})
