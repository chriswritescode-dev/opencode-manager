import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { createMockRepo, startMockProvider, type MockProvider, type MockRepo } from './mockProvider'
import { BASE_URL, STORAGE_STATE } from './env'

const MOCK_PROVIDER_PORT = 5566
const MARKERS = ['ALPHAMARKER', 'BRAVOMARKER', 'CHARLIEMARKER'] as const

const ENABLED_TTS = {
  enabled: true,
  provider: 'external' as const,
  autoPlay: false,
  endpoint: 'https://api.openai.com',
  apiKey: 'e2e-test-key',
  voice: 'alloy',
  model: 'tts-1',
  speed: 1,
}

const DEFAULT_TTS = {
  enabled: false,
  provider: 'external' as const,
  autoPlay: false,
  endpoint: 'https://api.openai.com',
  apiKey: '',
  voice: 'alloy',
  model: 'tts-1',
  speed: 1,
}

function buildSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 8000
  const channels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const dataSize = sampleRate * channels * bytesPerSample * durationSeconds
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  buffer.writeUInt16LE(channels * bytesPerSample, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

const SILENT_WAV = buildSilentWav(3)

function buildReply(marker: string): string {
  return Array.from(
    { length: 30 },
    (_, index) =>
      `${marker} paragraph ${index + 1}: this deliberately long filler sentence wraps across several lines on a narrow mobile viewport so the reply spans more than one screen.`,
  ).join('\n\n')
}

let api: APIRequestContext
let mockProvider: MockProvider
let mockRepo: MockRepo

async function seedReplies(sessionId: string): Promise<void> {
  for (const marker of MARKERS) {
    mockProvider.setReply(buildReply(marker))
    const response = await api.post(`/api/opencode/api/session/${sessionId}/prompt`, {
      data: { text: 'Reply with the next prepared paragraph set.' },
    })
    if (!response.ok()) {
      throw new Error(`seed prompt failed: ${response.status()} ${await response.text()}`)
    }
    await expect
      .poll(
        async () => {
          const messagesResponse = await api.get(`/api/opencode/api/session/${sessionId}/message?order=desc`)
          if (!messagesResponse.ok()) return false
          const body = (await messagesResponse.json()) as {
            data: Array<{ type?: string; time?: { completed?: number } }>
          }
          return body.data.some(
            (message) =>
              message.type === 'assistant' &&
              message.time?.completed !== undefined &&
              JSON.stringify(message).includes(marker),
          )
        },
        { timeout: 60_000 },
      )
      .toBe(true)
  }
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.beforeAll(async () => {
  mockProvider = await startMockProvider(MOCK_PROVIDER_PORT)
  mockRepo = await createMockRepo('e2e-tts-mock-repo', MOCK_PROVIDER_PORT)
  api = await playwrightRequest.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE })
  const settingsResponse = await api.patch('/api/settings', { data: { preferences: { tts: ENABLED_TTS } } })
  if (!settingsResponse.ok()) {
    throw new Error(`enable tts failed: ${settingsResponse.status()} ${await settingsResponse.text()}`)
  }
  await seedReplies(mockRepo.sessionId)
})

test.afterAll(async () => {
  if (api) {
    await api.patch('/api/settings', { data: { preferences: { tts: DEFAULT_TTS } } })
    await api.dispose()
  }
  if (mockProvider) {
    await mockProvider.close()
  }
})

async function recordSynthesis(page: Page, synthTexts: string[]): Promise<void> {
  await page.route('**/api/tts/synthesize', async (route) => {
    const body = route.request().postDataJSON() as { text: string }
    synthTexts.push(body.text)
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: SILENT_WAV })
  })
}

async function waitForSynthesisSettled(synthTexts: string[], lastExpectedText: string): Promise<void> {
  await expect.poll(() => synthTexts.join('\n')).toContain(lastExpectedText)
  let previousCount = -1
  await expect
    .poll(
      () => {
        const isSettled = synthTexts.length === previousCount
        previousCount = synthTexts.length
        return isSettled
      },
      { intervals: [500] },
    )
    .toBe(true)
}

test('plays the latest reply at the bottom and stops on the next tap', async ({ page }) => {
  const synthTexts: string[] = []
  await recordSynthesis(page, synthTexts)

  await page.goto(`/repos/${mockRepo.id}/sessions/${mockRepo.sessionId}`)

  const playButton = page.getByRole('button', { name: /play latest reply\. auto-play disabled/i })
  await expect(playButton).toBeVisible()
  await playButton.tap()

  await waitForSynthesisSettled(synthTexts, 'CHARLIEMARKER paragraph 30')
  expect(synthTexts.join('\n')).not.toContain('ALPHAMARKER')
  expect(synthTexts.join('\n')).not.toContain('BRAVOMARKER')

  await expect(page.getByRole('button', { name: /stop playback\. auto-play disabled/i })).toBeVisible()
  await page.getByRole('button', { name: /stop playback\. auto-play disabled/i }).tap()
  await expect(page.getByRole('button', { name: /play latest reply\. auto-play disabled/i })).toBeVisible()
})

test('reads the visible replies when scrolled up and stops on the next tap', async ({ page }) => {
  const synthTexts: string[] = []
  await recordSynthesis(page, synthTexts)

  await page.goto(`/repos/${mockRepo.id}/sessions/${mockRepo.sessionId}`)
  await expect(page.getByRole('button', { name: /play latest reply\. auto-play disabled/i })).toBeVisible()

  const container = page.getByTestId('session-message-scroll')
  await container.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
  })

  const readButton = page.getByRole('button', { name: /read visible replies\. auto-play disabled/i })
  await expect(readButton).toBeVisible()
  await readButton.tap()

  await waitForSynthesisSettled(synthTexts, 'ALPHAMARKER paragraph 30')
  expect(synthTexts.join('\n')).not.toContain('CHARLIEMARKER')

  await expect(page.getByRole('button', { name: /stop playback\. auto-play disabled/i })).toBeVisible()
  await page.getByRole('button', { name: /stop playback\. auto-play disabled/i }).tap()
  await expect(page.getByRole('button', { name: /read visible replies\. auto-play disabled/i })).toBeVisible()
})
