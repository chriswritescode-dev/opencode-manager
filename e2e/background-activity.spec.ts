import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'

const SHELL_COMMAND = 'sleep 300'

function locationQuery(directory: string): string {
  return new URLSearchParams({ 'location[directory]': directory }).toString()
}

function backgroundIndicator(page: Page) {
  return page.getByRole('main').getByLabel('Background tasks running')
}

function backgroundStatus(page: Page) {
  return page.getByRole('status').filter({ hasText: 'Background tasks running' })
}

async function requireOk(response: Awaited<ReturnType<APIRequestContext['post']>>, label: string): Promise<unknown> {
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`)
  }
  return response.json()
}

async function createSession(request: APIRequestContext, directory: string, parentID?: string): Promise<string> {
  const body = await requireOk(
    await request.post('/api/opencode/api/session', {
      data: { location: { directory }, ...(parentID ? { parentID } : {}) },
    }),
    'create session',
  )
  return (body as { data: { id: string } }).data.id
}

async function startBackgroundShell(
  request: APIRequestContext,
  directory: string,
  sessionID: string,
): Promise<string> {
  const body = await requireOk(
    await request.post(`/api/opencode/api/shell?${locationQuery(directory)}`, {
      data: { command: SHELL_COMMAND, timeout: 0, metadata: { sessionID, background: true } },
    }),
    'start background shell',
  )
  return (body as { data: { id: string } }).data.id
}

async function removeShell(request: APIRequestContext, directory: string, shellID: string): Promise<void> {
  const response = await request.delete(`/api/opencode/api/shell/${shellID}?${locationQuery(directory)}`)
  if (!response.ok() && response.status() !== 404) {
    throw new Error(`remove shell failed: ${response.status()} ${await response.text()}`)
  }
}

const createdShells: Array<{ directory: string; id: string }> = []

test.afterEach(async ({ request }) => {
  const shells = createdShells.splice(0)
  await Promise.allSettled(shells.map(({ directory, id }) => removeShell(request, directory, id)))
})

test.describe('session background activity', () => {
  test('shows the background indicator for a shell running before page load and clears it when removed', async ({
    page,
    request,
    repo,
  }) => {
    const sessionId = await createSession(request, repo.fullPath)
    const shellId = await startBackgroundShell(request, repo.fullPath, sessionId)
    createdShells.push({ directory: repo.fullPath, id: shellId })

    await page.goto(`/repos/${repo.id}/sessions/${sessionId}`)
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()

    await expect(backgroundIndicator(page)).toBeVisible()
    await expect(backgroundStatus(page)).toBeAttached()

    await removeShell(request, repo.fullPath, shellId)

    await expect(backgroundIndicator(page)).toBeHidden()
    await expect(backgroundStatus(page)).toHaveCount(0)
  })

  test('shows the background indicator when a shell starts while the page is open and clears it when removed', async ({
    page,
    request,
    repo,
  }) => {
    const sessionId = await createSession(request, repo.fullPath)

    await page.goto(`/repos/${repo.id}/sessions/${sessionId}`)
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()
    await expect(backgroundIndicator(page)).toHaveCount(0)

    const shellId = await startBackgroundShell(request, repo.fullPath, sessionId)
    createdShells.push({ directory: repo.fullPath, id: shellId })

    await expect(backgroundIndicator(page)).toBeVisible()
    await expect(backgroundStatus(page)).toBeAttached()

    await removeShell(request, repo.fullPath, shellId)

    await expect(backgroundIndicator(page)).toBeHidden()
    await expect(backgroundStatus(page)).toHaveCount(0)
  })

  test('shows the background indicator on a parent session when a child session owns the running shell', async ({
    page,
    request,
    repo,
  }) => {
    const parentId = await createSession(request, repo.fullPath)
    const childId = await createSession(request, repo.fullPath, parentId)
    const shellId = await startBackgroundShell(request, repo.fullPath, childId)
    createdShells.push({ directory: repo.fullPath, id: shellId })

    await page.goto(`/repos/${repo.id}/sessions/${parentId}`)
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()

    await expect(backgroundIndicator(page)).toBeVisible()
    await expect(backgroundStatus(page)).toBeAttached()

    await removeShell(request, repo.fullPath, shellId)

    await expect(backgroundIndicator(page)).toBeHidden()
    await expect(backgroundStatus(page)).toHaveCount(0)
  })

  test('shows no background indicator for a session with no running shells', async ({ page, request, repo }) => {
    const sessionId = await createSession(request, repo.fullPath)

    await page.goto(`/repos/${repo.id}/sessions/${sessionId}`)
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()

    await expect(backgroundIndicator(page)).toHaveCount(0)
    await expect(backgroundStatus(page)).toHaveCount(0)
  })
})
