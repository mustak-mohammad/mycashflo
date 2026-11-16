import { test, expect } from '@playwright/test'

test.describe('myCashflo Web local smoke', () => {
  test('renders login page heading and credentials form', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
    await expect(page.getByLabel(/work email address/i)).toBeVisible()
    await expect(page.getByLabel(/^password$/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in to workspace/i })).toBeEnabled()
  })
})

