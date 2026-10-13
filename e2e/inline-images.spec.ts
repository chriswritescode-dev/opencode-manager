import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { request as playwrightRequest, type APIRequestContext, type Locator } from '@playwright/test'
import { test, expect } from './fixtures'
import { BASE_URL, E2E_TMP, STORAGE_STATE } from './env'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQI12P8z8Dwn4GBgYGJAQoAHxcCAmep4oIAAAAASUVORK5CYII='
const WEBP_BASE64 = 'UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoCAAIAAgA0JaACdLoAA5gA/vmTb/+QH/+QH/+QH/8gP+IXeyAwAA=='

const PNG_BUFFER = Buffer.from(PNG_BASE64, 'base64')
const WEBP_BUFFER = Buffer.from(WEBP_BASE64, 'base64')

const MOCK_PROVIDER_PORT = 5565
const MOCK_MODEL_ID = 'mock-model'

let mockReply = ''
let mockServer: http.Server | undefined

interface MockRepo {
  id: number
  fullPath: string
  sessionId: string
}

let mockRepo: MockRepo

function rawFileUrl(filePath: string): string {
  return `/api/files?${new URLSearchParams({ raw: 'true', path: filePath })}`
}

async function expectImageLoaded(image: Locator): Promise<void> {
  await image.scrollIntoViewIfNeeded()
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0)
}

function handleMockRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.on('end', () => {
    const url = request.url ?? ''
    if (request.method === 'GET' && url.startsWith('/v1/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: MOCK_MODEL_ID, object: 'model', created: 0, owned_by: 'mock' }],
        }),
      )
      return
    }

    if (request.method === 'POST' && url.startsWith('/v1/chat/completions')) {
      let body: { stream?: boolean } = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        body = {}
      }

      const id = 'chatcmpl-mock'
      const created = Math.floor(Date.now() / 1000)
      const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }

      if (body.stream) {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        const base = { id, object: 'chat.completion.chunk', created, model: MOCK_MODEL_ID }
        response.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`,
        )
        response.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: mockReply }, finish_reason: null }] })}\n\n`,
        )
        response.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`,
        )
        response.write('data: [DONE]\n\n')
        response.end()
        return
      }

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model: MOCK_MODEL_ID,
          choices: [{ index: 0, message: { role: 'assistant', content: mockReply }, finish_reason: 'stop' }],
          usage,
        }),
      )
      return
    }

    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: `unhandled ${request.method} ${url}` } }))
  })
}

function git(directory: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
}

async function createSession(api: APIRequestContext, directory: string): Promise<string> {
  const response = await api.post('/api/opencode/api/session', { data: { location: { directory } } })
  if (!response.ok()) {
    throw new Error(`create session failed: ${response.status()} ${await response.text()}`)
  }
  const body = (await response.json()) as { data: { id: string } }
  return body.data.id
}

test.beforeAll(async () => {
  const server = http.createServer(handleMockRequest)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(MOCK_PROVIDER_PORT, '127.0.0.1', () => resolve())
  })
  mockServer = server

  const directory = path.join(E2E_TMP, 'workspace', 'repos', 'e2e-inline-mock-repo')
  fs.rmSync(directory, { recursive: true, force: true })
  fs.mkdirSync(path.join(directory, 'docs', 'img'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'docs', 'img', 'logo.png'), PNG_BUFFER)
  fs.writeFileSync(path.join(directory, 'docs', 'notes.txt'), 'attachment notes\n')
  fs.writeFileSync(
    path.join(directory, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        provider: {
          mock: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Mock',
            options: { baseURL: `http://127.0.0.1:${MOCK_PROVIDER_PORT}/v1`, apiKey: 'mock' },
            models: { [MOCK_MODEL_ID]: { name: 'Mock Model' } },
          },
        },
        model: `mock/${MOCK_MODEL_ID}`,
        small_model: `mock/${MOCK_MODEL_ID}`,
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(path.join(directory, 'README.md'), '# mock repository\n')
  git(directory, '-c', 'init.defaultBranch=main', 'init', '-q')
  git(directory, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'add', '-A')
  git(directory, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-q', '-m', 'initial commit')

  const api = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE })
  try {
    const repoResponse = await api.post('/api/repos', { data: { localPath: directory } })
    if (!repoResponse.ok()) {
      throw new Error(`register mock repo failed: ${repoResponse.status()} ${await repoResponse.text()}`)
    }
    const repo = (await repoResponse.json()) as { id: number; fullPath: string }
    const sessionId = await createSession(api, repo.fullPath)
    mockRepo = { id: repo.id, fullPath: repo.fullPath, sessionId }
  } finally {
    await api.dispose()
  }
})

test.afterAll(async () => {
  const server = mockServer
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
  mockServer = undefined
})

test.describe('inline markdown images', () => {
  test('file browser markdown preview resolves local images through the raw file API', async ({
    page,
    repo,
    request,
  }) => {
    const docsDir = path.join(repo.fullPath, 'docs')
    fs.mkdirSync(path.join(docsDir, 'img'), { recursive: true })
    fs.writeFileSync(path.join(docsDir, 'img', 'logo.png'), PNG_BUFFER)
    fs.writeFileSync(path.join(docsDir, 'img', 'pic.webp'), WEBP_BUFFER)
    fs.writeFileSync(
      path.join(docsDir, 'README.md'),
      ['# docs', '', '![logo](img/logo.png)', '', '![pic](img/pic.webp)', '', `![inline](data:image/png;base64,${PNG_BASE64})`, ''].join('\n'),
    )

    const repoDetailResponse = await request.get(`/api/repos/${repo.id}`)
    expect(repoDetailResponse.ok()).toBe(true)
    const { localPath } = (await repoDetailResponse.json()) as { localPath: string }

    const webpResponse = await request.get(rawFileUrl(`${localPath}/docs/img/pic.webp`))
    expect(webpResponse.ok()).toBe(true)
    expect(webpResponse.headers()['content-type']).toContain('image/webp')

    await page.goto(`/repos/${repo.id}?panel=files`)
    const filesPanel = page.locator('aside[aria-label="Files"]')
    await filesPanel.getByText('docs', { exact: true }).click()
    await filesPanel.getByText('README.md', { exact: true }).click()

    const logo = page.getByAltText('logo')
    await expect(logo).toHaveAttribute('src', rawFileUrl(`${localPath}/docs/img/logo.png`))
    await expectImageLoaded(logo)

    const pic = page.getByAltText('pic')
    await expect(pic).toHaveAttribute('src', rawFileUrl(`${localPath}/docs/img/pic.webp`))
    await expectImageLoaded(pic)

    const inline = page.getByAltText('inline')
    await expect(inline).toHaveAttribute('src', `data:image/png;base64,${PNG_BASE64}`)
    await expectImageLoaded(inline)
  })

  test('assistant markdown images resolve relative, absolute and inline data sources', async ({ page }) => {
    mockReply = [
      'Here are the images:',
      '',
      '![rel](docs/img/logo.png)',
      '',
      `![abs](${mockRepo.fullPath}/docs/img/logo.png)`,
      '',
      `![dataimg](data:image/png;base64,${PNG_BASE64})`,
      '',
      '![bad](data:text/html,hello)',
    ].join('\n')

    await page.goto(`/repos/${mockRepo.id}/sessions/${mockRepo.sessionId}`)
    const composer = page.getByPlaceholder('Send a message...')
    await expect(composer).toBeVisible()
    await composer.fill('render the images')
    await page.locator('[data-submit-prompt]').click()

    const expectedLocal = rawFileUrl(`${mockRepo.fullPath}/docs/img/logo.png`)

    const rel = page.getByAltText('rel')
    await expect(rel).toHaveAttribute('src', expectedLocal, { timeout: 60_000 })
    await expectImageLoaded(rel)

    const abs = page.getByAltText('abs')
    await expect(abs).toHaveAttribute('src', expectedLocal)
    await expectImageLoaded(abs)

    const dataimg = page.getByAltText('dataimg')
    await expect(dataimg).toHaveAttribute('src', `data:image/png;base64,${PNG_BASE64}`)
    await expectImageLoaded(dataimg)

    await expect(page.locator('img[alt="bad"]')).toHaveCount(0)
  })

  test('user attachments render images as thumbnails and other files as chips', async ({ page, request }) => {
    mockReply = 'Received your files.'
    const sessionId = await createSession(request, mockRepo.fullPath)

    await page.goto(`/repos/${mockRepo.id}/sessions/${sessionId}`)
    const composer = page.getByPlaceholder('Send a message...')
    await expect(composer).toBeVisible()

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: 'attachment.png', mimeType: 'image/png', buffer: PNG_BUFFER })
    await expect(page.getByText('attachment.png')).toBeVisible()
    await composer.fill('image attachment')
    await page.locator('[data-submit-prompt]').click()

    const thumbnail = page.getByAltText('attachment.png').first()
    await expect(thumbnail).toHaveAttribute('src', `data:image/png;base64,${PNG_BASE64}`, { timeout: 60_000 })
    await expectImageLoaded(thumbnail)

    const textFileResponse = await request.post(`/api/opencode/api/session/${sessionId}/prompt`, {
      data: {
        text: 'text attachment',
        files: [{ uri: `file://${mockRepo.fullPath}/docs/notes.txt`, name: 'notes.txt' }],
      },
    })
    expect(textFileResponse.ok()).toBe(true)

    await expect(page.getByText('notes.txt').first()).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('img[alt="notes.txt"]')).toHaveCount(0)
  })
})
