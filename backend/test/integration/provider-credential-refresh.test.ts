import { describe, it, expect, vi } from 'vitest'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import { createProvidersRoutes } from '../../src/routes/providers'
import { FetchOpenCodeClient } from '../../src/services/opencode/client'
import { resolveOpenCode2Binary, startOpenCodeServe } from '../helpers/opencode-binary'
import type { OpenCodeServe } from '../helpers/opencode-binary'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const PROVIDER_ID = 'anthropic'
const EVENT_TIMEOUT_MS = 30000

type EventStream = {
  types: string[]
  waitFor: (type: string, fromIndex?: number) => Promise<void>
  close: () => void
}

async function openEventStream(serve: OpenCodeServe): Promise<EventStream> {
  const controller = new AbortController()
  const response = await fetch(`${serve.baseUrl}/api/event`, {
    headers: { Authorization: buildOpenCodeBasicAuth(serve.password), Accept: 'text/event-stream' },
    signal: controller.signal,
  })
  if (!response.ok || !response.body) throw new Error(`event stream failed with status ${response.status}`)

  const types: string[] = []
  const listeners = new Set<() => void>()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  void (async () => {
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const event = JSON.parse(line.slice(5)) as { type: string }
          types.push(event.type)
          for (const listener of listeners) listener()
        }
      }
    } catch {
      return
    }
  })()

  const waitFor = (type: string, fromIndex = 0) => new Promise<void>((resolve, reject) => {
    const check = () => {
      if (!types.slice(fromIndex).includes(type)) return false
      listeners.delete(listener)
      clearTimeout(timer)
      resolve()
      return true
    }
    const listener = () => {
      check()
    }
    const timer = setTimeout(() => {
      listeners.delete(listener)
      reject(new Error(`event ${type} was not emitted; received ${types.slice(fromIndex).join(', ')}`))
    }, EVENT_TIMEOUT_MS)
    listeners.add(listener)
    check()
  })

  return { types, waitFor, close: () => controller.abort() }
}

describe.skipIf(!resolveOpenCode2Binary())('provider credential refresh against a real OpenCode 2 server', () => {
  it('lists the provider and its models after a key is connected immediately after server start', async () => {
    const serve = await startOpenCodeServe({ env: { ANTHROPIC_API_KEY: '' } })
    const events = await openEventStream(serve)
    try {
      const client = new FetchOpenCodeClient({
        baseUrl: serve.baseUrl,
        basicAuth: buildOpenCodeBasicAuth(serve.password),
      })
      const app = createProvidersRoutes(client)

      const eventIndex = events.types.length
      const connectResponse = await app.request(`/${PROVIDER_ID}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-ant-e2e-test-key' }),
      })
      expect(connectResponse.status).toBe(200)

      const providersAfter = (await client.api.provider.list()).data.map((provider) => provider.id)
      const modelsAfter = (await client.api.model.list()).data.filter((model) => model.providerID === PROVIDER_ID)
      expect(providersAfter).toContain(PROVIDER_ID)
      expect(modelsAfter.length).toBeGreaterThan(0)

      const statusAfter = await app.request(`/${PROVIDER_ID}/credentials/status`)
      expect(await statusAfter.json()).toEqual({ hasCredentials: true })

      await events.waitFor('credential.updated', eventIndex)
      await events.waitFor('provider.updated', eventIndex)
      await events.waitFor('model.updated', eventIndex)
    } finally {
      events.close()
      await serve.stop()
    }
  }, 120000)
})
