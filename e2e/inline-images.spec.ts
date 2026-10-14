import fs from 'node:fs'
import path from 'node:path'
import { type Locator } from '@playwright/test'
import { test, expect } from './fixtures'
import { createMockRepo, createSession, startMockProvider, type MockProvider, type MockRepo } from './mockProvider'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQI12P8z8Dwn4GBgYGJAQoAHxcCAmep4oIAAAAASUVORK5CYII='
const WEBP_BASE64 = 'UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoCAAIAAgA0JaACdLoAA5gA/vmTb/+QH/+QH/+QH/8gP+IXeyAwAA=='

const PNG_BUFFER = Buffer.from(PNG_BASE64, 'base64')
const WEBP_BUFFER = Buffer.from(WEBP_BASE64, 'base64')

const MOCK_PROVIDER_PORT = 5565

let mockProvider: MockProvider
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

test.beforeAll(async () => {
  mockProvider = await startMockProvider(MOCK_PROVIDER_PORT)
  mockRepo = await createMockRepo('e2e-inline-mock-repo', MOCK_PROVIDER_PORT, {
    beforeCommit: (directory) => {
      fs.mkdirSync(path.join(directory, 'docs', 'img'), { recursive: true })
      fs.writeFileSync(path.join(directory, 'docs', 'img', 'logo.png'), PNG_BUFFER)
      fs.writeFileSync(path.join(directory, 'docs', 'notes.txt'), 'attachment notes\n')
    },
  })
})

test.afterAll(async () => {
  await mockProvider.close()
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
    mockProvider.setReply([
      'Here are the images:',
      '',
      '![rel](docs/img/logo.png)',
      '',
      `![abs](${mockRepo.fullPath}/docs/img/logo.png)`,
      '',
      `![dataimg](data:image/png;base64,${PNG_BASE64})`,
      '',
      '![bad](data:text/html,hello)',
    ].join('\n'))

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
    mockProvider.setReply('Received your files.')
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
