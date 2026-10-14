import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { BASE_URL, E2E_TMP, STORAGE_STATE } from './env'

const MOCK_MODEL_ID = 'mock-model'

export interface MockProvider {
  setReply(text: string): void
  close(): Promise<void>
}

export interface MockRepo {
  id: number
  fullPath: string
  sessionId: string
}

export interface CreateMockRepoOptions {
  beforeCommit?: (directory: string) => void
}

function handleMockRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  getReply: () => string,
): void {
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

      const mockReply = getReply()
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

export async function startMockProvider(port: number): Promise<MockProvider> {
  let mockReply = ''
  const server = http.createServer((request, response) => {
    handleMockRequest(request, response, () => mockReply)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  return {
    setReply: (text) => {
      mockReply = text
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

function git(directory: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
}

export async function createSession(api: APIRequestContext, directory: string): Promise<string> {
  const response = await api.post('/api/opencode/api/session', { data: { location: { directory } } })
  if (!response.ok()) {
    throw new Error(`create session failed: ${response.status()} ${await response.text()}`)
  }
  const body = (await response.json()) as { data: { id: string } }
  return body.data.id
}

export async function createMockRepo(
  name: string,
  port: number,
  options: CreateMockRepoOptions = {},
): Promise<MockRepo> {
  const directory = path.join(E2E_TMP, 'workspace', 'repos', name)
  fs.rmSync(directory, { recursive: true, force: true })
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        provider: {
          mock: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Mock',
            options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'mock' },
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
  options.beforeCommit?.(directory)
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
    return { id: repo.id, fullPath: repo.fullPath, sessionId }
  } finally {
    await api.dispose()
  }
}
