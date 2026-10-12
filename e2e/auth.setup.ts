import { test, expect } from './fixtures'
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, STORAGE_STATE } from './env'

test('authenticate as the env admin', async ({ page, request }) => {
  await page.goto('/login')

  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('button', { name: 'Repo', exact: true })).toBeVisible()

  await page.context().storageState({ path: STORAGE_STATE })

  await expect
    .poll(
      async () => {
        const response = await request.get(`${BASE_URL}/api/health`)
        if (!response.ok()) return `http-${response.status()}`
        const body = await response.json()
        return body.opencode
      },
      { timeout: 120_000, message: 'OpenCode server did not become healthy' },
    )
    .toBe('healthy')
})
