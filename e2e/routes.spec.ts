import { test, expect } from './fixtures'

test.describe('application routes', () => {
  test('repos list renders the registered repository', async ({ page, repo }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Repo', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: repo.name })).toBeVisible()
  })

  test('repo detail renders', async ({ page, repo }) => {
    await page.goto(`/repos/${repo.id}`)
    await expect(page.getByRole('heading', { name: repo.name })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Session', exact: true })).toBeVisible()
  })

  test('repo assistant renders', async ({ page, repo }) => {
    await page.goto(`/repos/${repo.id}/assistant`)
    await expect(page.getByRole('heading', { name: 'Assistant' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Session', exact: true })).toBeVisible()
  })

  test('global assistant renders', async ({ page }) => {
    await page.goto('/assistant')
    await expect(page.getByRole('heading', { name: 'Assistant' })).toBeVisible()
  })

  test('session detail renders', async ({ page, repo }) => {
    await page.goto(`/repos/${repo.id}/sessions/${repo.sessionId}`)
    await expect(page.getByTestId('session-header-region')).toBeVisible()
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()
  })

  test('repo schedules renders', async ({ page, repo }) => {
    await page.goto(`/repos/${repo.id}/schedules`)
    await expect(page.getByRole('button', { name: `Switch repository (${repo.name})` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Schedule' })).toBeVisible()
  })

  test('global schedules renders', async ({ page }) => {
    await page.goto('/schedules')
    await expect(page.getByRole('button', { name: 'Switch repository (All repos)' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Jobs' })).toBeVisible()
  })
})

test.describe('unauthenticated routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('login page renders the credentials form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  })

  test('register redirects to login', async ({ page }) => {
    await page.goto('/register')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  })

  test('setup redirects to login', async ({ page }) => {
    await page.goto('/setup')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  })

  test('protected route redirects to login', async ({ page }) => {
    await page.goto('/schedules')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  })
})
