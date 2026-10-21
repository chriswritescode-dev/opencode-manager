import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { E2E_TMP } from './env'

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
  return response.status() === 204 ? null : response.json()
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
const createdDirectories: string[] = []
let directoryCounter = 0

function createUnregisteredDirectory(name: string): string {
  directoryCounter += 1
  const directory = path.join(E2E_TMP, `background-${name}-${process.pid}-${directoryCounter}`)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'README.md'), '# background activity fixture\n')

  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
  git('-c', 'init.defaultBranch=main', 'init', '-q')
  git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'add', '-A')
  git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-q', '-m', 'init')

  createdDirectories.push(directory)
  return directory
}

function waitForDirectorySubscription(page: Page, directory: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes('/api/sse/subscribe') && (response.request().postData() ?? '').includes(directory),
  )
}

async function navigateWithinApp(page: Page, url: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, url)
}

test.afterEach(async ({ request }) => {
  const shells = createdShells.splice(0)
  const results = await Promise.allSettled(shells.map(({ directory, id }) => removeShell(request, directory, id)))
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [String(result.reason)] : []))
  expect(failures, 'background shell cleanup failed').toEqual([])

  createdDirectories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }))
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

  test('shows the indicator for a shell started in an unregistered session directory before page load', async ({
    page,
    request,
    repo,
  }) => {
    const directory = createUnregisteredDirectory('preload')
    const sessionId = await createSession(request, directory)
    const shellId = await startBackgroundShell(request, directory, sessionId)
    createdShells.push({ directory, id: shellId })

    await page.goto(`/repos/${repo.id}/sessions/${sessionId}`)
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()

    await expect(backgroundIndicator(page)).toBeVisible()

    await removeShell(request, directory, shellId)

    await expect(backgroundIndicator(page)).toBeHidden()
  })

  test('keeps an unregistered session directory subscribed while its shell runs and clears the indicator after it exits elsewhere', async ({
    page,
    request,
    repo,
  }) => {
    const directory = createUnregisteredDirectory('stale')
    const sessionId = await createSession(request, directory)
    const subscribed = waitForDirectorySubscription(page, directory)

    await page.goto(`/repos/${repo.id}/sessions/${sessionId}`)
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()
    expect((await subscribed).ok()).toBe(true)

    const shellId = await startBackgroundShell(request, directory, sessionId)
    createdShells.push({ directory, id: shellId })

    await expect(backgroundIndicator(page)).toBeVisible()

    const unsubscribes: string[] = []
    page.on('request', (outgoing) => {
      if (outgoing.url().includes('/api/sse/unsubscribe') && (outgoing.postData() ?? '').includes(directory)) {
        unsubscribes.push(outgoing.url())
      }
    })

    await navigateWithinApp(page, '/')
    await removeShell(request, directory, shellId)
    await navigateWithinApp(page, `/repos/${repo.id}/sessions/${sessionId}`)

    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()
    await expect(backgroundIndicator(page)).toBeHidden({ timeout: 20_000 })
    expect(unsubscribes).toEqual([])
  })

  test('follows a session moved to another directory without a reload', async ({ page, request, repo }) => {
    const source = createUnregisteredDirectory('move-source')
    const target = createUnregisteredDirectory('move-target')
    const sessionId = await createSession(request, source)
    const subscribedToSource = waitForDirectorySubscription(page, source)

    await page.goto(`/repos/${repo.id}/sessions/${sessionId}`)
    await expect(page.getByPlaceholder('Send a message...')).toBeVisible()
    expect((await subscribedToSource).ok()).toBe(true)

    const subscribedToTarget = waitForDirectorySubscription(page, target)
    await requireOk(
      await request.post(`/api/opencode/api/session/${sessionId}/move`, { data: { directory: target } }),
      'move session',
    )
    expect((await subscribedToTarget).ok()).toBe(true)

    const shellId = await startBackgroundShell(request, target, sessionId)
    createdShells.push({ directory: target, id: shellId })

    await expect(backgroundIndicator(page)).toBeVisible()

    await removeShell(request, target, shellId)

    await expect(backgroundIndicator(page)).toBeHidden()
  })
})
