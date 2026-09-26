import { describe, it, expect } from 'vitest'
import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import path from 'path'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import {
  createOpenCodeServeDirectories,
  resolveOpenCode2Binary,
  startOpenCodeServe,
} from '../helpers/opencode-binary'
import type { OpenCodeServe } from '../helpers/opencode-binary'
import { getOpenCodeServiceRegistrationPath } from '../../src/services/opencode-service-mode'

const OPENCODE_BIN = resolveOpenCode2Binary()
const RESTART_CONTINUE_TEXT = 'The server restarted while you were working. Continue from where you left off without repeating completed work.'
const POLL_INTERVAL_MS = 250
const WAIT_TIMEOUT_MS = 60000

type MockLlm = {
  port: number
  requestBodies: string[]
  respondFromNowOn: () => void
  close: () => Promise<void>
}

function writeCompletion(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const base = { id: 'chatcmpl-resume', object: 'chat.completion.chunk', created: 1, model: 'mock-model' }
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: 'resumed' }, finish_reason: null }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

function holdCompletionOpen(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const base = { id: 'chatcmpl-held', object: 'chat.completion.chunk', created: 1, model: 'mock-model' }
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`)
}

async function startHoldingMockLlm(): Promise<MockLlm> {
  const requestBodies: string[] = []
  const openResponses = new Set<ServerResponse>()
  let holding = true
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }))
      return
    }
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404)
      res.end()
      return
    }
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      requestBodies.push(body)
      if (holding) {
        openResponses.add(res)
        res.on('close', () => openResponses.delete(res))
        holdCompletionOpen(res)
        return
      }
      writeCompletion(res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return {
    port: (server.address() as AddressInfo).port,
    requestBodies,
    respondFromNowOn: () => {
      holding = false
    },
    close: async () => {
      for (const res of openResponses) res.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function waitFor<T>(description: string, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function requestJson<T>(serve: OpenCodeServe, pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${serve.baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: buildOpenCodeBasicAuth(serve.password),
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} failed with ${response.status}: ${text}`)
  return (text ? JSON.parse(text) : undefined) as T
}

async function readActiveSessionIDs(serve: OpenCodeServe): Promise<string[]> {
  const body = await requestJson<{ data: Record<string, unknown> }>(serve, '/api/session/active')
  return Object.keys(body.data)
}

describe.skipIf(OPENCODE_BIN === null)('OpenCode 2 service mode resumes sessions interrupted by a graceful restart', () => {
  it('re-drives a session that was active at SIGTERM once the service restarts on the same state', async () => {
    const directories = await createOpenCodeServeDirectories()
    const repoPath = path.join(directories.root, 'repo')
    await mkdir(repoPath, { recursive: true })
    await mkdir(path.join(directories.configHome, 'opencode'), { recursive: true })
    const llm = await startHoldingMockLlm()
    await writeFile(
      path.join(directories.configHome, 'opencode', 'opencode.json'),
      JSON.stringify({
        providers: {
          mock: {
            package: '@opencode/ai/providers/openai-compatible',
            name: 'Mock',
            settings: { baseURL: `http://127.0.0.1:${llm.port}/v1`, apiKey: 'mock-key' },
            models: { 'mock-model': { name: 'Mock Model' } },
          },
        },
        model: 'mock/mock-model',
        permissions: [{ action: '*', resource: '*', effect: 'allow' }],
      }),
    )

    let serve: OpenCodeServe | null = null
    try {
      serve = await startOpenCodeServe({ service: true, directories })
      const firstServe = serve
      const registration = JSON.parse(await readFile(getOpenCodeServiceRegistrationPath({ XDG_CONFIG_HOME: directories.configHome, XDG_STATE_HOME: directories.stateHome }), 'utf8')) as { password: string }
      expect(registration.password).toBe(firstServe.password)

      const session = await requestJson<{ data: { id: string } }>(firstServe, '/api/session', {
        method: 'POST',
        body: JSON.stringify({ location: { directory: repoPath } }),
      })
      const sessionID = session.data.id
      await requestJson(firstServe, `/api/session/${sessionID}/prompt`, {
        method: 'POST',
        body: JSON.stringify({ text: 'Start a long task' }),
      })

      await waitFor('the first LLM request', async () => (llm.requestBodies.length >= 1 ? true : undefined))
      await waitFor('the session to be active', async () => ((await readActiveSessionIDs(firstServe)).includes(sessionID) ? true : undefined))

      const heldRequestCount = llm.requestBodies.length
      llm.respondFromNowOn()
      await firstServe.terminate()
      serve = null

      serve = await startOpenCodeServe({ service: true, directories, port: firstServe.port, password: firstServe.password })
      const secondServe = serve

      const resumedRequest = await waitFor('a resumed LLM request', async () =>
        llm.requestBodies.slice(heldRequestCount).find((body) => body.includes(RESTART_CONTINUE_TEXT)),
      )
      expect(resumedRequest).toContain(RESTART_CONTINUE_TEXT)

      const messages = await waitFor('the synthetic continue message', async () => {
        const text = JSON.stringify(await requestJson<unknown>(secondServe, `/api/session/${sessionID}/message`))
        return text.includes(RESTART_CONTINUE_TEXT) ? text : undefined
      })
      expect(messages).toContain(RESTART_CONTINUE_TEXT)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serve?.readOutput() ?? ''}`, { cause: error })
    } finally {
      if (serve) await serve.terminate()
      await llm.close()
      await rm(directories.root, { recursive: true, force: true })
    }
  }, 180000)
})
