import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveOpenCodeModel: vi.fn(),
  fetch: vi.fn(),
  sleep: vi.fn(),
}))

vi.mock('../../src/services/opencode-models', () => ({
  resolveOpenCodeModel: mocks.resolveOpenCodeModel,
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    OPENCODE: { PORT: 5551 },
  },
}))

import { createTitleRoutes } from '../../src/routes/title'

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status: number = 200): Response {
  return new Response(body, { status })
}

describe('Title Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveOpenCodeModel.mockResolvedValue({ providerID: 'openai', modelID: 'gpt-5-mini' })
    vi.stubGlobal('fetch', mocks.fetch)
    vi.stubGlobal('Bun', { sleep: mocks.sleep })
    mocks.sleep.mockResolvedValue(undefined)
  })

  it('updates the session title from an immediate JSON prompt response', async () => {
    const app = createTitleRoutes()

    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ id: 'title-session-1' }))
      .mockResolvedValueOnce(textResponse(JSON.stringify({
        parts: [{ type: 'text', text: 'Refactoring background jobs' }],
      })))
      .mockResolvedValueOnce(textResponse('', 200))
      .mockResolvedValueOnce(textResponse('', 200))

    const response = await app.request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        directory: '/workspace/repos/sample-project',
      },
      body: JSON.stringify({
        text: 'Refactor recurring background jobs and improve observability.',
        sessionID: 'session-main-1',
      }),
    })
    const body = await response.json() as { title: string }

    expect(response.status).toBe(200)
    expect(body.title).toBe('Refactoring background jobs')
    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5551/session/session-main-1?directory=%2Fworkspace%2Frepos%2Fsample-project',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('polls session messages when the prompt endpoint returns an empty body', async () => {
    const app = createTitleRoutes()

    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ id: 'title-session-2' }))
      .mockResolvedValueOnce(textResponse(''))
      .mockResolvedValueOnce(jsonResponse([
        {
          info: { role: 'assistant', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: 'Analyzing recurring job setup' }],
        },
      ]))
      .mockResolvedValueOnce(textResponse('', 200))
      .mockResolvedValueOnce(textResponse('', 200))

    const response = await app.request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        directory: '/workspace/repos/sample-project',
      },
      body: JSON.stringify({
        text: 'Why do recurring jobs stop after a restart?',
        sessionID: 'session-main-2',
      }),
    })
    const body = await response.json() as { title: string }

    expect(response.status).toBe(200)
    expect(body.title).toBe('Analyzing recurring job setup')
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:5551/session/title-session-2/message?directory=%2Fworkspace%2Frepos%2Fsample-project',
    )
  })

  it('returns a 500 when the polled assistant message reports an error', async () => {
    const app = createTitleRoutes()

    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ id: 'title-session-3' }))
      .mockResolvedValueOnce(textResponse(''))
      .mockResolvedValueOnce(jsonResponse([
        {
          info: {
            role: 'assistant',
            error: { data: { message: 'Model unavailable' } },
          },
          parts: [],
        },
      ]))
      .mockResolvedValueOnce(textResponse('', 200))

    const response = await app.request('http://localhost/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        directory: '/workspace/repos/sample-project',
      },
      body: JSON.stringify({
        text: 'Generate a title for this broken run.',
        sessionID: 'session-main-3',
      }),
    })
    const body = await response.json() as { error: string }

    expect(response.status).toBe(500)
    expect(body.error).toBe('Model unavailable')
  })
})
