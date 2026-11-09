import { test, expect } from './fixtures'

const PROJECT_QUERY = (repoId: number) => new RegExp(`menu=sessions.*menuProject=repo(?:%3A|:)${repoId}`)

test.describe('phone side menu', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('home shows the menu button and no header bell or gear', async ({ page, repo }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: repo.name })).toBeVisible()

    const header = page.locator('main header')
    await expect(header.getByRole('button', { name: /^Menu/ })).toBeVisible()
    await expect(header.getByRole('button', { name: /settings|notifications/i })).toHaveCount(0)
  })

  test('tapping a repo card opens the full-width menu on that repo hub', async ({ page, repo }) => {
    await page.goto('/')
    await page.getByRole('heading', { name: repo.name }).click()

    const menu = page.getByRole('dialog', { name: 'Menu' })
    await expect(menu).toBeVisible()
    await expect(menu).toHaveAttribute('data-width', '100vw')
    await expect(menu.getByRole('button', { name: 'New Session' })).toBeVisible()
    await expect(page).toHaveURL(PROJECT_QUERY(repo.id))

    await menu.getByRole('button', { name: 'Close menu' }).click()
    await expect(menu).toBeHidden()
  })

  test('the legacy repo route lands on the hub and back does not return to it', async ({ page, repo }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: repo.name })).toBeVisible()

    await page.goto(`/repos/${repo.id}`)
    await expect(page).toHaveURL(PROJECT_QUERY(repo.id))
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'New Session' })).toBeVisible()

    await page.goBack()
    await expect(page).not.toHaveURL(new RegExp(`/repos/${repo.id}`))
    await expect(page.getByRole('heading', { name: repo.name })).toBeVisible()
  })

  test('the session header has a Back arrow and no overflow menu', async ({ page, repo }) => {
    await page.goto(`/repos/${repo.id}/sessions/${repo.sessionId}`)

    const header = page.getByTestId('session-header-region')
    await expect(header).toBeVisible()
    await expect(header.getByRole('button', { name: /^Back/ })).toBeVisible()
    await expect(header.getByRole('button', { name: /^More/ })).toHaveCount(0)

    await header.getByRole('button', { name: /^Back/ }).click()
    await expect(page).toHaveURL(PROJECT_QUERY(repo.id))
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'New Session' })).toBeVisible()
  })

  test('the Sessions tab opens the menu sessions page and stays active', async ({ page, repo }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: repo.name })).toBeVisible()

    const sessionsTab = page.getByRole('button', { name: 'Sessions', exact: true })
    await sessionsTab.click()

    await expect(page).toHaveURL(/menu=sessions/)
    await expect(page.getByTestId('side-menu-sessions-page')).toBeVisible()
    await expect(sessionsTab).toHaveClass(/border-primary/)
  })
})

test.describe('desktop sidebar', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the sidebar shows the repo hub and the tab destinations for a repo card tap', async ({ page, repo }) => {
    await page.goto('/')
    await page.getByRole('heading', { name: repo.name }).click()

    const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
    await expect(sidebar.getByRole('button', { name: 'New Session' })).toBeVisible()
    await expect(page).toHaveURL(PROJECT_QUERY(repo.id))

    const hubBox = await sidebar.getByRole('button', { name: 'New Session' }).boundingBox()
    const sessionsTab = sidebar.getByRole('button', { name: 'Sessions', exact: true })
    await expect(sessionsTab).toBeVisible()
    for (const name of ['Files', 'Git', 'Assistant']) {
      await expect(sidebar.getByRole('button', { name, exact: true })).toBeVisible()
    }
    const tabBox = await sessionsTab.boundingBox()
    expect(hubBox).not.toBeNull()
    expect(tabBox).not.toBeNull()
    expect(tabBox!.y).toBeGreaterThan(hubBox!.y)
  })

  test('headers have no bell, gear or overflow menu', async ({ page, repo }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: repo.name })).toBeVisible()

    const header = page.locator('main header')
    await expect(header.getByRole('button', { name: /settings|notifications|more/i })).toHaveCount(0)
  })

  test('the transcript column is capped on wide screens', async ({ page, repo }) => {
    await page.goto(`/repos/${repo.id}/sessions/${repo.sessionId}`)
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()

    const column = page.getByTestId('session-message-scroll').locator('.max-w-4xl').first()
    await expect(column).toBeVisible()
    const box = await column.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeLessThanOrEqual(897)
  })
})
