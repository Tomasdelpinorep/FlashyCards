import { expect, expectAccessible, test } from './fixtures'

test.describe('card detail', () => {
  test('edit the translation, sentence and note; suspend takes the card out of Train', async ({ page, api, deck, shot }) => {
    const [hund] = await api.readyCards(deck.id, 'Hund')
    await api.review(hund!.id, 1)
    expect((await api.stats(deck.id)).dueNow).toBe(1)

    await page.goto(`/words/${hund!.id}`)
    await page.getByRole('button', { name: 'Edit' }).click()
    const form = page.getByRole('form', { name: 'Edit word' })
    await form.getByLabel('Translation', { exact: true }).fill('doggo')
    await form.getByLabel('Add a translation').fill('pup')
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(form.getByRole('button', { name: 'Remove pup' })).toBeVisible()
    await form.getByRole('textbox', { name: 'Example sentence' }).fill('Mein [[Hund]] schläft.')
    await form.getByRole('textbox', { name: 'Note' }).fill('Not a cat')
    await expectAccessible(page, 'card edit form')
    await shot('card-edit-form')
    await form.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('doggo · also: pup')).toBeVisible()
    await expect(page.locator('mark', { hasText: 'Hund' })).toBeVisible()
    await expect(page.getByText('Note: Not a cat')).toBeVisible()

    await page.getByRole('button', { name: 'Suspend' }).click()
    await expect(page.getByTestId('suspended-badge')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unsuspend' })).toBeVisible()
    await shot('card-suspended')
    expect(await api.stats(deck.id)).toMatchObject({ suspended: 1, ready: 0, dueNow: 0 })

    await page.goto('/words?status=suspended')
    await expect(page.getByRole('listitem').filter({ hasText: 'der Hund' })).toContainText('Suspended · doggo')

    await page.goto('/train')
    await expect(page.getByText('All done', { exact: true })).toBeVisible()

    await page.goto(`/words/${hund!.id}`)
    await page.getByRole('button', { name: 'Unsuspend' }).click()
    await expect(page.getByRole('button', { name: 'Suspend' })).toBeVisible()
    await expect.poll(async () => (await api.stats(deck.id)).dueNow).toBe(1)
  })
})
