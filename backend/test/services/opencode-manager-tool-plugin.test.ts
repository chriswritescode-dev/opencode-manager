import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import path from 'path'
import os from 'os'
import { ASSISTANT_NOTIFICATION_LIMITS, AssistantNotificationRequestSchema } from '@opencode-manager/shared/schemas'
import { MANAGER_TOOL_NAME, MANAGER_TOOL_ALLOWED_ROUTES, parseAllowedRoute } from '../../src/services/opencode-manager-tool-plugin'
import { installManagedPlugins, getOpenCodePluginDir } from '../../src/services/opencode/plugin-registry'
import { loadGeneratedPlugin, type GeneratedTool } from '../helpers/opencode-plugin-context'
import { resolveOpenCode2Binary, runOpenCodeStandalone } from '../helpers/opencode-binary'

type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  anyOf?: JsonSchema[]
  enum?: string[]
  maxLength?: number
  minLength?: number
}

async function loadTool(configHome: string): Promise<GeneratedTool> {
  const plugin = await loadGeneratedPlugin(path.join(getOpenCodePluginDir(configHome), 'ocm-manager.js'))
  const tool = plugin.registeredTools().find((candidate) => candidate.name === MANAGER_TOOL_NAME)
  if (!tool?.execute) throw new Error(`The generated plugin does not register a "${MANAGER_TOOL_NAME}" tool`)
  return tool
}

function toolInputSchema(tool: GeneratedTool): JsonSchema {
  return tool.input as JsonSchema
}

function notificationParamsSchema(tool: GeneratedTool): JsonSchema {
  return toolInputSchema(tool).properties?.params?.anyOf?.[0] ?? {}
}

function requestParamsSchema(tool: GeneratedTool): JsonSchema {
  return toolInputSchema(tool).properties?.params?.anyOf?.[1] ?? {}
}

async function runTool(tool: GeneratedTool, input: unknown): Promise<string> {
  const result = (await tool.execute!(input, { signal: new AbortController().signal })) as { content: string }
  return result.content
}

function jsonResponse(body: unknown, { ok = true, status = 200 } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(body),
  })
}

describe('ocm-manager plugin', () => {
  let configHome: string

  beforeEach(async () => {
    configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-manager-'))
    await installManagedPlugins(configHome)
    process.env.OCM_INTERNAL_API_URL = 'http://localhost:5003/api/internal'
    process.env.OCM_INTERNAL_TOKEN = 'secret-token'
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.OCM_INTERNAL_API_URL
    delete process.env.OCM_INTERNAL_TOKEN
    await fs.rm(configHome, { recursive: true, force: true })
  })

  it('default-exports the V2 plugin definition', async () => {
    const plugin = await loadGeneratedPlugin(path.join(getOpenCodePluginDir(configHome), 'ocm-manager.js'))

    expect(plugin.id).toBe('ocm.manager')
  })

  it('writes a plugin file with no zod import and no import statement', async () => {
    const source = await fs.readFile(path.join(getOpenCodePluginDir(configHome), 'ocm-manager.js'), 'utf-8')

    expect(source).not.toContain('zod')
    expect(source).not.toMatch(/(^|\n)\s*import\b/)
    expect(source).toContain("id: 'ocm.manager'")
  })

  it('registers the manager tool with the documented JSON Schema', async () => {
    const tool = await loadTool(configHome)
    const schema = toolInputSchema(tool)

    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['action', 'params'])
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties?.action?.enum).toEqual(['send_notification', 'request'])
    expect(schema.properties?.params?.anyOf).toHaveLength(2)
    expect(notificationParamsSchema(tool).required).toEqual(['title', 'body'])
    expect(requestParamsSchema(tool).required).toEqual(['method', 'path'])
    expect(notificationParamsSchema(tool).additionalProperties).toBe(false)
    expect(requestParamsSchema(tool).additionalProperties).toBe(false)
    expect(notificationParamsSchema(tool).properties?.priority?.enum).toEqual(['normal', 'high'])
    expect(requestParamsSchema(tool).properties?.method?.enum).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  })

  it('enforces the notification limits the internal API enforces', async () => {
    const tool = await loadTool(configHome)
    const notification = notificationParamsSchema(tool)
    const withinLimits = { title: 'x'.repeat(ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX), body: 'b'.repeat(ASSISTANT_NOTIFICATION_LIMITS.BODY_MAX) }
    const overLimit = { title: 'x'.repeat(ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX + 1), body: 'b' }

    expect(notification.properties?.title?.maxLength).toBe(ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX)
    expect(notification.properties?.body?.maxLength).toBe(ASSISTANT_NOTIFICATION_LIMITS.BODY_MAX)
    expect(notification.properties?.url?.maxLength).toBe(ASSISTANT_NOTIFICATION_LIMITS.URL_MAX)
    expect(notification.properties?.tag?.maxLength).toBe(ASSISTANT_NOTIFICATION_LIMITS.TAG_MAX)
    expect(notification.properties?.title?.minLength).toBe(1)
    expect(notification.properties?.body?.minLength).toBe(1)
    expect(notification.properties?.url?.minLength).toBe(1)
    expect(requestParamsSchema(tool).properties?.path?.minLength).toBe(1)
    expect(requestParamsSchema(tool).properties?.path?.maxLength).toBe(500)
    expect(notification.required).toEqual(['title', 'body'])
    expect(AssistantNotificationRequestSchema.safeParse(withinLimits).success).toBe(true)
    expect(AssistantNotificationRequestSchema.safeParse(overLimit).success).toBe(false)
  })

  it('sends a notification through the internal API with the host token', async () => {
    const fetchMock = jsonResponse({ delivered: 2, expired: 0, failed: 0, noSubscriptions: false })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await runTool(tool, {
      action: 'send_notification',
      params: { title: 'Storm watch', body: 'Formation odds crossed 40%', priority: 'high' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/notifications/send')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(JSON.parse(init.body)).toEqual({ title: 'Storm watch', body: 'Formation odds crossed 40%', priority: 'high' })
    expect(result).toBe('Notification sent: 2 delivered, 0 failed.')
  })

  it('reports when the user has no registered devices', async () => {
    vi.stubGlobal('fetch', jsonResponse({ delivered: 0, expired: 0, failed: 0, noSubscriptions: true }))
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'send_notification', params: { title: 't', body: 'b' } }))
      .resolves.toBe('No devices are registered for push notifications, so nothing was delivered.')
  })

  it('surfaces the API status and body when the request is rejected', async () => {
    vi.stubGlobal('fetch', jsonResponse({ error: 'Rate limit exceeded' }, { ok: false, status: 429 }))
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'send_notification', params: { title: 't', body: 'b' } }))
      .rejects.toThrow(/429.*Rate limit exceeded/)
  })

  it('fails when the internal API is not configured', async () => {
    delete process.env.OCM_INTERNAL_TOKEN
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'send_notification', params: { title: 't', body: 'b' } }))
      .rejects.toThrow('The OpenCode Manager internal API is not configured for this OpenCode server.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unknown actions and invalid params without calling the API', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'constructor', params: {} })).rejects.toThrow(/Unknown OpenCode Manager action/)
    await expect(runTool(tool, { action: 'send_notification', params: { title: 't' } })).rejects.toThrow(/Invalid parameters/)
    await expect(runTool(tool, { action: 'request', params: null })).rejects.toThrow(/Invalid parameters/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects params belonging to the other action without calling the API', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'request', params: { title: 't', body: 'b' } }))
      .rejects.toThrow(/Invalid parameters for OpenCode Manager action: request/)
    await expect(runTool(tool, { action: 'send_notification', params: { method: 'GET', path: '/settings' } }))
      .rejects.toThrow(/Invalid parameters for OpenCode Manager action: send_notification/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends an allow-listed GET request with a query string and no body', async () => {
    const fetchMock = jsonResponse({ userId: 'default', theme: 'dark' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await runTool(tool, { action: 'request', params: { method: 'GET', path: '/settings?userId=default' } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/settings?userId=default')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.headers['content-type']).toBeUndefined()
    expect(init.body).toBeUndefined()
    expect(result).toBe('{"userId":"default","theme":"dark"}')
  })

  it('sends a PATCH request with a JSON body', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await runTool(tool, { action: 'request', params: { method: 'PATCH', path: '/settings', body: { theme: 'dark' } } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/settings')
    expect(init.method).toBe('PATCH')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ theme: 'dark' })
  })

  it('sends a PUT request with a JSON body', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await runTool(tool, { action: 'request', params: { method: 'PUT', path: '/opencode-config', body: { content: { theme: 'dark' } } } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/opencode-config')
    expect(init.method).toBe('PUT')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ content: { theme: 'dark' } })
  })

  it('allows every route in the exported allow list', async () => {
    const tool = await loadTool(configHome)

    for (const route of MANAGER_TOOL_ALLOWED_ROUTES) {
      const { method, path: pattern } = parseAllowedRoute(route)
      const path = pattern.split('/').map((segment) => (segment === '*' ? 'x' : segment)).join('/')
      const fetchMock = jsonResponse({})
      vi.stubGlobal('fetch', fetchMock)

      await runTool(tool, { action: 'request', params: { method, path } })

      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects non-allow-listed routes without calling the API', async () => {
    const tool = await loadTool(configHome)
    const deniedRoutes = [
      ['GET', '/git-credentials/gh-env'],
      ['POST', '/sandbox/shell'],
      ['GET', '/repos/0/mirror/head'],
      ['POST', '/notifications/send'],
      ['DELETE', '/settings'],
    ] as const

    for (const [method, path] of deniedRoutes) {
      const fetchMock = jsonResponse({})
      vi.stubGlobal('fetch', fetchMock)

      await expect(runTool(tool, { action: 'request', params: { method, path } }))
        .rejects.toThrow(/is not an allowed OpenCode Manager route/)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('normalizes path traversal and rejects the resolved route without calling the API', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(
      runTool(tool, { action: 'request', params: { method: 'GET', path: '/repos/x/../../git-credentials/gh-env' } }),
    ).rejects.toThrow(/is not an allowed OpenCode Manager route/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an absolute URL that resolves outside the internal API', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'request', params: { method: 'GET', path: 'http://evil.com/steal' } }))
      .rejects.toThrow(/resolves outside/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the empty-body message when the response body is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'request', params: { method: 'GET', path: '/settings' } }))
      .resolves.toBe('The request succeeded with an empty response body.')
  })

  it('surfaces the API status and body when the request action is rejected', async () => {
    vi.stubGlobal('fetch', jsonResponse({ error: 'Rate limit exceeded' }, { ok: false, status: 429 }))
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'request', params: { method: 'GET', path: '/settings' } }))
      .rejects.toThrow(/429.*Rate limit exceeded/)
  })
})

const SHIPPED_OPENCODE_BIN = resolveOpenCode2Binary()

type ChatRequest = { messages?: unknown[]; tools?: { function?: { name?: string; parameters?: unknown } }[] }

describe.skipIf(SHIPPED_OPENCODE_BIN === null)('ocm-manager plugin against the shipped OpenCode 2 binary', () => {
  let root: string

  function startInternalApiServer(requests: string[]) {
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        if (req.method === 'POST' && req.url?.endsWith('/notifications/send')) {
          requests.push(JSON.stringify({ auth: req.headers.authorization, body }))
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ delivered: 1, expired: 0, failed: 0, noSubscriptions: false }))
      })
    })
    return new Promise<{ server: http.Server; port: number }>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }))
    })
  }

  function startLlmServer(offeredTools: ChatRequest['tools'][], toolResults: string[]) {
    const server = http.createServer((req, res) => {
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
        const parsed = JSON.parse(body || '{}') as ChatRequest
        offeredTools.push(parsed.tools ?? [])
        const messages = parsed.messages ?? []
        const toolMessages = messages.filter((m) => (m as { role?: string }).role === 'tool')
        for (const message of toolMessages) {
          toolResults.push(String((message as { content?: unknown }).content ?? ''))
        }

        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const writeChunk = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
        const base = { id: 'chatcmpl-e2e', object: 'chat.completion.chunk', created: 1, model: 'mock-model' }
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0

        if (hasTools && toolMessages.length === 0) {
          const args = JSON.stringify({
            action: 'send_notification',
            params: { title: 'Storm watch', body: 'Formation odds crossed 40%', priority: 'high' },
          })
          writeChunk({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: MANAGER_TOOL_NAME, arguments: '' } }],
                },
                finish_reason: null,
              },
            ],
          })
          writeChunk({
            ...base,
            choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }],
          })
          writeChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
        } else {
          writeChunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
          writeChunk({ ...base, choices: [{ index: 0, delta: { content: 'FINAL' }, finish_reason: null }] })
          writeChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
        }
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    return new Promise<{ server: http.Server; port: number }>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }))
    })
  }

  function writeOpenCodeConfig(configHome: string, llmPort: number) {
    writeFileSync(
      path.join(configHome, 'opencode', 'opencode.json'),
      JSON.stringify({
        providers: {
          mock: {
            package: '@opencode/ai/providers/openai-compatible',
            name: 'Mock',
            settings: { baseURL: `http://127.0.0.1:${llmPort}/v1`, apiKey: 'mock-key' },
            models: { 'mock-model': { name: 'Mock Model' } },
          },
        },
        model: 'mock/mock-model',
        permissions: [{ action: '*', resource: '*', effect: 'allow' }],
      }),
    )
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ocm-manager-e2e-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('offers the tool to the model and sends the notification from the Manager process', async () => {
    const configHome = path.join(root, 'config')
    const workDir = path.join(root, 'work')
    mkdirSync(path.join(configHome, 'opencode'), { recursive: true })
    mkdirSync(workDir, { recursive: true })

    const apiRequests: string[] = []
    const offeredTools: ChatRequest['tools'][] = []
    const toolResults: string[] = []
    const api = await startInternalApiServer(apiRequests)
    const llm = await startLlmServer(offeredTools, toolResults)
    writeOpenCodeConfig(configHome, llm.port)
    await installManagedPlugins(configHome)

    try {
      const result = await runOpenCodeStandalone({
        cwd: workDir,
        env: {
          ...process.env,
          HOME: root,
          XDG_CONFIG_HOME: configHome,
          XDG_DATA_HOME: path.join(root, 'data'),
          XDG_STATE_HOME: path.join(root, 'state'),
          XDG_CACHE_HOME: path.join(root, 'cache'),
          OPENCODE_DISABLE_MODELS_FETCH: '1',
          PWD: workDir,
          OCM_SANDBOX_ENFORCED: 'false',
          OCM_INTERNAL_API_URL: `http://127.0.0.1:${api.port}/api/internal`,
          OCM_INTERNAL_TOKEN: 'test-token',
        },
        message: 'notify the user',
      })

      expect(result.status).toBe(0)

      const managerTool = offeredTools.flatMap((tools) => tools ?? []).find((t) => t.function?.name === MANAGER_TOOL_NAME)
      expect(managerTool?.function?.parameters).toMatchObject({
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['send_notification', 'request'] },
          params: {
            anyOf: [
              {
                type: 'object',
                required: ['title', 'body'],
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX },
                  body: { type: 'string', minLength: 1, maxLength: ASSISTANT_NOTIFICATION_LIMITS.BODY_MAX },
                  url: { type: 'string', maxLength: ASSISTANT_NOTIFICATION_LIMITS.URL_MAX },
                  tag: { type: 'string', maxLength: ASSISTANT_NOTIFICATION_LIMITS.TAG_MAX },
                  priority: { type: 'string', enum: ['normal', 'high'] },
                },
              },
              {
                type: 'object',
                required: ['method', 'path'],
                properties: {
                  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
                  path: { type: 'string', minLength: 1, maxLength: 500 },
                  body: { type: 'object' },
                },
              },
            ],
          },
        },
        required: ['action', 'params'],
      })

      expect(apiRequests).toHaveLength(1)
      const request = JSON.parse(apiRequests[0] as string) as { auth: string; body: string }
      expect(request.auth).toBe('Bearer test-token')
      expect(JSON.parse(request.body)).toEqual({ title: 'Storm watch', body: 'Formation odds crossed 40%', priority: 'high' })
      expect(toolResults.some((output) => output.includes('Notification sent: 1 delivered, 0 failed.'))).toBe(true)
    } finally {
      api.server.close()
      llm.server.close()
    }
  }, 120000)
})
