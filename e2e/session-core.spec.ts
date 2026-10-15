import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  TOOL_FOLLOW_UP_TEXT,
  createMockRepo,
  createSession,
  startMockProvider,
  type MockProvider,
  type MockRepo,
} from './mockProvider'

const MOCK_PROVIDER_PORT = 5567

const STREAM_TRIGGER = 'STREAMTEST'
const STOP_TRIGGER = 'STOPTEST'
const ALLOW_TRIGGER = 'PERMALLOW'
const DENY_TRIGGER = 'PERMDENY'

const STREAM_EARLY = 'EARLYSTREAM part one.'
const STREAM_MIDDLE = 'MIDDLESTREAM part two.'
const STREAM_FINAL = 'FINALSTREAM part three.'

const STOP_EARLY = 'EARLYSTOP part one.'
const STOP_LATE = 'LATESTOP part two.'
const STOP_CHUNK_DELAY_MS = 3000

const ALLOW_MARKER = 'allow-marker.txt'
const DENY_MARKER = 'deny-marker.txt'

let mockProvider: MockProvider
let mockRepo: MockRepo
let allowMarkerPath: string
let denyMarkerPath: string

test.beforeAll(async () => {
  mockProvider = await startMockProvider(MOCK_PROVIDER_PORT)
  mockRepo = await createMockRepo('e2e-session-core-mock-repo', MOCK_PROVIDER_PORT, {
    config: { permission: { bash: 'ask' } },
  })
  allowMarkerPath = path.join(mockRepo.fullPath, ALLOW_MARKER)
  denyMarkerPath = path.join(mockRepo.fullPath, DENY_MARKER)
  fs.rmSync(allowMarkerPath, { force: true })
  fs.rmSync(denyMarkerPath, { force: true })
  mockProvider.setStreamReply(STREAM_TRIGGER, [STREAM_EARLY, STREAM_MIDDLE, STREAM_FINAL], 3000)
  mockProvider.setStreamReply(STOP_TRIGGER, [STOP_EARLY, STOP_LATE], STOP_CHUNK_DELAY_MS)
  mockProvider.setToolCallReply(ALLOW_TRIGGER, 'shell', { command: `printf allow > "${allowMarkerPath}"` })
  mockProvider.setToolCallReply(DENY_TRIGGER, 'shell', { command: `printf deny > "${denyMarkerPath}"` })
})

test.afterAll(async () => {
  await mockProvider.close()
})

function stopButton(page: Page) {
  return page.locator('button[title="Stop"]:visible')
}

async function openComposer(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/repos/${mockRepo.id}/sessions/${sessionId}`)
  await expect(page.getByPlaceholder('Send a message...')).toBeVisible()
}

async function submitPrompt(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder('Send a message...')
  await composer.fill(text)
  await page.locator('[data-submit-prompt]').click()
}

test.describe('core chat session flow', () => {
  test('sends a prompt and streams the assistant reply incrementally', async ({ page, request }) => {
    const sessionId = await createSession(request, mockRepo.fullPath)
    await openComposer(page, sessionId)

    await submitPrompt(page, `${STREAM_TRIGGER} please stream a reply`)

    await expect(page.getByText('please stream a reply')).toBeVisible()
    await expect(page.getByText(STREAM_EARLY)).toBeVisible()
    await expect(page.getByText(STREAM_FINAL)).toHaveCount(0)

    await expect(page.getByText(STREAM_FINAL)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(STREAM_MIDDLE)).toBeVisible()
    await expect(stopButton(page)).toHaveCount(0)
  })

  test('stops a running reply and never renders the aborted continuation', async ({ page, request }) => {
    const sessionId = await createSession(request, mockRepo.fullPath)
    await openComposer(page, sessionId)

    await submitPrompt(page, `${STOP_TRIGGER} please stream slowly`)

    await expect(page.getByText(STOP_EARLY)).toBeVisible()
    await expect(stopButton(page)).toBeVisible()
    await stopButton(page).click()

    await expect(stopButton(page)).toHaveCount(0)
    await page.waitForTimeout(STOP_CHUNK_DELAY_MS + 1000)
    await expect(page.getByText(STOP_LATE)).toHaveCount(0)
  })

  test('allows a requested command once and continues with the follow-up reply', async ({ page, request }) => {
    fs.rmSync(allowMarkerPath, { force: true })
    const sessionId = await createSession(request, mockRepo.fullPath)
    await openComposer(page, sessionId)

    await submitPrompt(page, `${ALLOW_TRIGGER} run the command`)

    const allowOnce = page.getByRole('button', { name: 'Allow Once', exact: true })
    await expect(allowOnce).toBeVisible()
    await allowOnce.click()

    await expect.poll(() => fs.existsSync(allowMarkerPath), { timeout: 30_000 }).toBe(true)
    await expect(page.getByText(TOOL_FOLLOW_UP_TEXT)).toBeVisible({ timeout: 30_000 })
    await expect(stopButton(page)).toHaveCount(0)
  })

  test('denies a requested command and leaves the session idle', async ({ page, request }) => {
    fs.rmSync(denyMarkerPath, { force: true })
    const sessionId = await createSession(request, mockRepo.fullPath)
    await openComposer(page, sessionId)

    await submitPrompt(page, `${DENY_TRIGGER} run the command`)

    const deny = page.getByRole('button', { name: 'Deny', exact: true })
    await expect(deny).toBeVisible()
    await deny.click()

    await expect(deny).toBeHidden()
    await expect(stopButton(page)).toHaveCount(0)
    expect(fs.existsSync(denyMarkerPath)).toBe(false)
  })
})
