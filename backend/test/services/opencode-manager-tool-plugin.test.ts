import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import path from 'path'
import os from 'os'
import {
  ASSISTANT_NOTIFICATION_LIMITS,
  AssistantNotificationRequestSchema,
  BUILTIN_OUTPUT_DEFINITIONS,
  MANAGER_PROMPT_CLIENT_METADATA_KEY,
  MANAGER_TOOL_NAME,
} from '@opencode-manager/shared/schemas'
import {
  MANAGER_MOBILE_OUTPUT_INSTRUCTIONS,
  MANAGER_TOOL_ALLOWED_ROUTES,
  parseAllowedRoute,
} from '../../src/services/opencode-manager-tool-plugin'
import { installManagedPlugins, getOpenCodePluginDir } from '../../src/services/opencode/plugin-registry'
import { loadGeneratedPlugin, type GeneratedPlugin, type GeneratedTool, type SessionContextEvent } from '../helpers/opencode-plugin-context'
import { resolveOpenCode2Binary, runOpenCodeStandalone } from '../helpers/opencode-binary'

const OUTPUT_READY_MESSAGE =
  'The output is ready. It opens in the Manager Outputs panel when this session is open on desktop; otherwise the user can open it from this tool call.'

type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  enum?: string[]
  const?: string
  maxLength?: number
  minLength?: number
  description?: string
}

/** Loads the installed manager plugin from the supplied configuration home for hook tests. */
async function loadManagerPlugin(configHome: string): Promise<GeneratedPlugin> {
  return loadGeneratedPlugin(path.join(getOpenCodePluginDir(configHome), 'ocm-manager.js'))
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

function openOutputParamsSchema(tool: GeneratedTool): JsonSchema {
  return toolInputSchema(tool).properties?.params?.anyOf?.[2] ?? {}
}

function artifactParamsSchema(tool: GeneratedTool): JsonSchema {
  return toolInputSchema(tool).properties?.params?.anyOf?.[3] ?? {}
}

function defineOutputParamsSchema(tool: GeneratedTool): JsonSchema {
  return toolInputSchema(tool).properties?.params?.anyOf?.[4] ?? {}
}

function readOutputInputParamsSchema(tool: GeneratedTool): JsonSchema {
  return toolInputSchema(tool).properties?.params?.anyOf?.[5] ?? {}
}

function publishOutputParamsSchema(tool: GeneratedTool): JsonSchema {
  return toolInputSchema(tool).properties?.params?.anyOf?.[6] ?? {}
}

async function runToolResult(
  tool: GeneratedTool,
  input: unknown,
  context: { sessionID?: string; signal?: AbortSignal } = {},
): Promise<{ content: string; metadata?: Record<string, unknown> }> {
  return (await tool.execute!(input, { signal: context.signal ?? new AbortController().signal, sessionID: context.sessionID })) as {
    content: string
    metadata?: Record<string, unknown>
  }
}

async function runTool(tool: GeneratedTool, input: unknown, context: { sessionID?: string; signal?: AbortSignal } = {}): Promise<string> {
  return (await runToolResult(tool, input, context)).content
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

  describe('mobile output instructions', () => {
    it('adds the mobile output instructions to a session prompted from the mobile client', async () => {
      const plugin = await loadManagerPlugin(configHome)
      await plugin.triggerSessionPrompt({ sessionID: 'ses_mobile', metadata: { [MANAGER_PROMPT_CLIENT_METADATA_KEY]: 'mobile' } })
      const event: SessionContextEvent = { sessionID: 'ses_mobile', system: [] }

      await plugin.triggerSessionContext(event)

      expect(event.system).toEqual([{ type: 'text', text: MANAGER_MOBILE_OUTPUT_INSTRUCTIONS }])
    })

    it('removes the mobile output instructions when the latest prompt is from the desktop client', async () => {
      const plugin = await loadManagerPlugin(configHome)
      await plugin.triggerSessionPrompt({ sessionID: 'ses_switch', metadata: { [MANAGER_PROMPT_CLIENT_METADATA_KEY]: 'mobile' } })
      await plugin.triggerSessionPrompt({ sessionID: 'ses_switch', metadata: { [MANAGER_PROMPT_CLIENT_METADATA_KEY]: 'desktop' } })
      const event: SessionContextEvent = { sessionID: 'ses_switch', system: [] }

      await plugin.triggerSessionContext(event)

      expect(event.system).toEqual([])
    })

    it('keeps the mobile output instructions when a later prompt carries no client metadata', async () => {
      const plugin = await loadManagerPlugin(configHome)
      await plugin.triggerSessionPrompt({ sessionID: 'ses_nometa', metadata: { [MANAGER_PROMPT_CLIENT_METADATA_KEY]: 'mobile' } })
      await plugin.triggerSessionPrompt({ sessionID: 'ses_nometa' })
      const event: SessionContextEvent = { sessionID: 'ses_nometa', system: [] }

      await plugin.triggerSessionContext(event)

      expect(event.system).toEqual([{ type: 'text', text: MANAGER_MOBILE_OUTPUT_INSTRUCTIONS }])
    })

    it('leaves sessions prompted from another client without the mobile output instructions', async () => {
      const plugin = await loadManagerPlugin(configHome)
      await plugin.triggerSessionPrompt({ sessionID: 'ses_mobile', metadata: { [MANAGER_PROMPT_CLIENT_METADATA_KEY]: 'mobile' } })
      const event: SessionContextEvent = { sessionID: 'ses_other', system: [] }

      await plugin.triggerSessionContext(event)

      expect(event.system).toEqual([])
    })
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
    expect(schema.properties?.action?.enum).toEqual(['send_notification', 'request', 'open_output', 'show_artifact', 'define_output', 'read_output_input', 'publish_output'])
    expect(schema.properties?.params?.anyOf).toHaveLength(7)
    expect(notificationParamsSchema(tool).required).toEqual(['title', 'body'])
    expect(requestParamsSchema(tool).required).toEqual(['method', 'path'])
    expect(openOutputParamsSchema(tool).required).toEqual(['definitionId'])
    expect(artifactParamsSchema(tool).required).toEqual(['title', 'path'])
    expect(defineOutputParamsSchema(tool).required).toEqual(['definition'])
    expect(readOutputInputParamsSchema(tool).required).toBeUndefined()
    expect(publishOutputParamsSchema(tool).required).toBeUndefined()
    expect(notificationParamsSchema(tool).additionalProperties).toBe(false)
    expect(requestParamsSchema(tool).additionalProperties).toBe(false)
    expect(openOutputParamsSchema(tool).additionalProperties).toBe(false)
    expect(artifactParamsSchema(tool).additionalProperties).toBe(false)
    expect(defineOutputParamsSchema(tool).additionalProperties).toBe(false)
    expect(readOutputInputParamsSchema(tool).additionalProperties).toBe(false)
    expect(publishOutputParamsSchema(tool).additionalProperties).toBe(false)
    expect(notificationParamsSchema(tool).properties?.priority?.enum).toEqual(['normal', 'high'])
    expect(requestParamsSchema(tool).properties?.method?.enum).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    expect(openOutputParamsSchema(tool).properties?.definitionId?.minLength).toBe(1)
    expect(openOutputParamsSchema(tool).properties?.definitionId?.maxLength).toBe(48)
    expect(readOutputInputParamsSchema(tool).properties?.file?.minLength).toBe(1)
    expect(readOutputInputParamsSchema(tool).properties?.file?.maxLength).toBe(1000)
  })

  it('lists the output actions and built-in definition ids in the description', async () => {
    const tool = await loadTool(configHome)

    expect(tool.description).toContain('open_output')
    expect(tool.description).toContain('separate-session definition starts its output session')
    expect(tool.description).toContain('define_output')
    expect(tool.description).toContain('read_output_input')
    expect(tool.description).toContain('publish_output')
    for (const definition of BUILTIN_OUTPUT_DEFINITIONS) {
      expect(tool.description).toContain(`${definition.id} (${definition.description})`)
    }
    expect(tool.description).toContain('when the user asks to walk through, review or explain the changes')
    expect(openOutputParamsSchema(tool).properties?.definitionId?.description).toContain('walkthrough')
  })

  it('lists the show_artifact action in the description', async () => {
    const tool = await loadTool(configHome)

    expect(tool.description).toContain('show_artifact')
    expect(tool.description).toContain('write a self-contained .html file with your file tools')
    expect(tool.description).toContain('rendered inline in this session')
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

  it('opens a current-session output and returns its instructions and data schema', async () => {
    const dataSchema = { type: 'object', properties: { title: { type: 'string' } } }
    const fetchMock = jsonResponse({
      definition: {
        id: 'walkthrough',
        label: 'Walkthrough',
        generation: 'currentSession',
        instructions: 'Build the walkthrough.',
        renderer: { kind: 'builtin', id: 'walkthrough' },
        dataSchema,
      },
      output: null,
      generating: false,
      currentInputHash: null,
      hasInput: true,
      stale: false,
      running: false,
      error: null,
    })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await runToolResult(tool, { action: 'open_output', params: { definitionId: 'walkthrough' } }, { sessionID: 'ses_abc' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/outputs/ses_abc?definitionId=walkthrough')
    expect(init.method).toBe('GET')
    expect(result.content).toContain('Build the walkthrough.')
    expect(result.content).toContain('publish_output')
    expect(result.content).toContain('definitionId: "walkthrough"')
    expect(result.content).toContain('data')
    expect(result.content).toContain(JSON.stringify(dataSchema, null, 2))
    expect(result.metadata).toEqual({ definitionId: 'walkthrough', params: undefined })
  })

  it('opens a current-session html output and asks for a file path', async () => {
    const fetchMock = jsonResponse({
      definition: {
        id: 'walkthrough',
        label: 'Walkthrough',
        generation: 'currentSession',
        instructions: 'Build the walkthrough.',
        renderer: { kind: 'html' },
      },
      output: null,
      generating: false,
      currentInputHash: null,
      hasInput: true,
      stale: false,
      running: false,
      error: null,
    })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await runToolResult(tool, { action: 'open_output', params: { definitionId: 'walkthrough' } }, { sessionID: 'ses_abc' })

    expect(result.content).toContain('Build the walkthrough.')
    expect(result.content).toContain('publish_output')
    expect(result.content).toContain(', path }')
    expect(result.content).not.toContain('data }')
  })

  it('starts a separate-session output and returns immediately when it is ready', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            definition: { id: 'walkthrough', label: 'Walkthrough', generation: 'separateSession' },
            output: null,
            generating: false,
            error: null,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ definition: { generation: 'separateSession' }, output: { status: 'ready' }, generating: false, error: null }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await runToolResult(tool, { action: 'open_output', params: { definitionId: 'walkthrough' } }, { sessionID: 'ses_abc' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [stateUrl, stateInit] = fetchMock.mock.calls[0] ?? []
    expect(stateUrl).toBe('http://localhost:5003/api/internal/outputs/ses_abc?definitionId=walkthrough')
    expect(stateInit.method).toBe('GET')
    const [startUrl, startInit] = fetchMock.mock.calls[1] ?? []
    expect(startUrl).toBe('http://localhost:5003/api/internal/outputs/ses_abc')
    expect(startInit.method).toBe('POST')
    expect(startInit.headers.Authorization).toBe('Bearer secret-token')
    expect(JSON.parse(startInit.body)).toEqual({ definitionId: 'walkthrough' })
    expect(result.content).toBe(OUTPUT_READY_MESSAGE)
  })

  it('polls a separate-session output until it is ready and encodes the params in the poll query', async () => {
    const params = { source: { kind: 'staged' } }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            definition: { id: 'walkthrough', label: 'Walkthrough', generation: 'separateSession' },
            output: null,
            generating: false,
            error: null,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ output: null, generating: true, error: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ output: { status: 'ready' }, generating: false, error: null }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    vi.useFakeTimers()
    try {
      const pending = runToolResult(tool, { action: 'open_output', params: { definitionId: 'walkthrough', params } }, { sessionID: 'ses_abc' })
      await vi.advanceTimersByTimeAsync(2000)
      const result = await pending

      expect(fetchMock).toHaveBeenCalledTimes(3)
      const [pollUrl, pollInit] = fetchMock.mock.calls[2] ?? []
      expect(pollUrl).toContain('?definitionId=walkthrough&params=' + encodeURIComponent(JSON.stringify(params)))
      expect(pollInit.method).toBe('GET')
      expect(result.content).toBe(OUTPUT_READY_MESSAGE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws when the output fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ definition: { generation: 'separateSession' }, output: null, generating: false, error: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ output: null, generating: true, error: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ output: { status: 'failed' }, generating: false, error: { message: 'the model crashed' } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    vi.useFakeTimers()
    try {
      const pending = runTool(tool, { action: 'open_output', params: { definitionId: 'walkthrough' } }, { sessionID: 'ses_abc' })
      const assertion = expect(pending).rejects.toThrow('The output failed: the model crashed')
      await vi.advanceTimersByTimeAsync(2000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws when the output was cancelled before it was ready', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ definition: { generation: 'separateSession' }, output: { status: 'cancelled' }, generating: false, error: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ definition: { generation: 'separateSession' }, output: { status: 'cancelled' }, generating: false, error: null }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'open_output', params: { definitionId: 'walkthrough' } }, { sessionID: 'ses_abc' }))
      .rejects.toThrow('The output was cancelled before it was ready.')
  })

  it('stops waiting for the output when the signal is aborted', async () => {
    const fetchMock = jsonResponse({ definition: { generation: 'separateSession' }, output: null, generating: true })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)
    const controller = new AbortController()

    const pending = runTool(tool, { action: 'open_output', params: { definitionId: 'walkthrough' } }, { sessionID: 'ses_abc', signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toThrow(/aborted/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('defines a current-session output through the internal API', async () => {
    const params = {
      definition: {
        id: 'notes',
        label: 'Notes',
        description: '',
        icon: 'FileText',
        params: [],
        instructions: 'Write notes.',
        renderer: { kind: 'html' },
        generation: 'currentSession',
      },
    }
    const fetchMock = jsonResponse({ definition: { id: 'notes' } })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await runTool(tool, { action: 'define_output', params }, { sessionID: 'ses_abc' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/output-actions/ses_abc/define')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(JSON.parse(init.body)).toEqual(params)
    expect(result).toBe('Defined the output "notes" for this session.')
  })

  it('requests the output input outline with no body', async () => {
    const fetchMock = jsonResponse({ text: '## Outline' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'read_output_input', params: {} }, { sessionID: 'ses_abc' })).resolves.toBe('## Outline')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/output-actions/ses_abc/input')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.headers['content-type']).toBeUndefined()
    expect(init.body).toBeUndefined()
  })

  it('requests one changed file through read_output_input', async () => {
    const fetchMock = jsonResponse({ text: 'diff' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await runTool(tool, { action: 'read_output_input', params: { file: 'src/a.ts' } }, { sessionID: 'ses_abc' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/output-actions/ses_abc/input')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ file: 'src/a.ts' })
  })

  it('publishes the output through the internal API and reports the output directory', async () => {
    const fetchMock = jsonResponse({ outputDir: '/workspace/outputs/ses_abc/gen', uncoveredHunkIds: [] })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await runToolResult(
      tool,
      { action: 'publish_output', params: { data: { title: 'T' } } },
      { sessionID: 'ses_abc' },
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/output-actions/ses_abc/publish')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ data: { title: 'T' } })
    expect(result.content).toBe(
      'Published the output from /workspace/outputs/ses_abc/gen. The Manager Outputs panel renders it; edit it and call publish_output again after significant changes.',
    )
    expect(result.metadata).toEqual({ outputDir: '/workspace/outputs/ses_abc/gen' })
  })

  it('reports unreferenced hunks after publishing an output', async () => {
    const fetchMock = jsonResponse({ outputDir: '/workspace/outputs/ses_abc/gen', uncoveredHunkIds: ['h1', 'h2'] })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await runTool(tool, { action: 'publish_output', params: { data: { title: 'T' } } }, { sessionID: 'ses_abc' })

    expect(result).toContain('Unreferenced hunks: h1, h2. They are shown under Other changes; add them to stops if they matter.')
  })

  it('resolves the artifact file through the internal API and reports the resolved path', async () => {
    const fetchMock = jsonResponse({ path: '/workspace/repos/app/report.html' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await runToolResult(
      tool,
      { action: 'show_artifact', params: { title: 'Formation odds', path: 'reports/report.html' } },
      { sessionID: 'ses_abc' },
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/session-artifacts/ses_abc/resolve')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ path: 'reports/report.html' })
    expect(result.content).toBe(
      'Showing the artifact "Formation odds" from /workspace/repos/app/report.html in the Manager chat. It renders the current file contents, so after editing the file the user can reload the view; call show_artifact again only to show a different file.',
    )
    expect(result.metadata).toEqual({ path: '/workspace/repos/app/report.html' })
  })

  it('surfaces the resolve error when the artifact path is rejected', async () => {
    vi.stubGlobal('fetch', jsonResponse({ error: 'Artifact file not found: reports/report.html' }, { ok: false, status: 404 }))
    const tool = await loadTool(configHome)

    await expect(
      runTool(tool, { action: 'show_artifact', params: { title: 'Formation odds', path: 'reports/report.html' } }, { sessionID: 'ses_abc' }),
    ).rejects.toThrow(/404.*Artifact file not found: reports\/report\.html/)
  })

  it('rejects a show_artifact call missing path without calling the API', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(runTool(tool, { action: 'show_artifact', params: { title: 'Formation odds' } }, { sessionID: 'ses_abc' }))
      .rejects.toThrow('Invalid parameters for OpenCode Manager action: show_artifact. Missing required parameter: path.')
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

  it('sends a PATCH request to the config route with a JSON body', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await runTool(tool, { action: 'request', params: { method: 'PATCH', path: '/opencode-config', body: { patch: { theme: 'dark' } } } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/opencode-config')
    expect(init.method).toBe('PATCH')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ patch: { theme: 'dark' } })
  })

  it('allows every route in the exported allow list', async () => {
    const tool = await loadTool(configHome)

    expect(MANAGER_TOOL_ALLOWED_ROUTES.some((route) => route.includes('/outputs') || route.includes('/output-actions') || route.includes('/output-definitions'))).toBe(false)

    for (const route of MANAGER_TOOL_ALLOWED_ROUTES) {
      const { method, path: pattern } = parseAllowedRoute(route)
      const path = pattern.split('/').map((segment) => (segment === '*' ? 'x' : segment)).join('/')
      const fetchMock = jsonResponse({})
      vi.stubGlobal('fetch', fetchMock)

      await runTool(tool, { action: 'request', params: { method, path } })

      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('allows session routes and rejects session deletion', async () => {
    const tool = await loadTool(configHome)
    const allowedRoutes = [
      ['POST', '/sessions'],
      ['GET', '/sessions/abc/reply'],
    ] as const

    for (const [method, path] of allowedRoutes) {
      const fetchMock = jsonResponse({})
      vi.stubGlobal('fetch', fetchMock)

      await runTool(tool, { action: 'request', params: { method, path } })

      expect(fetchMock).toHaveBeenCalledTimes(1)
    }

    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)

    await expect(runTool(tool, { action: 'request', params: { method: 'DELETE', path: '/sessions/abc' } }))
      .rejects.toThrow(/is not an allowed OpenCode Manager route/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-allow-listed routes without calling the API', async () => {
    const tool = await loadTool(configHome)
    const deniedRoutes = [
      ['GET', '/shell-env'],
      ['POST', '/sandbox/shell'],
      ['GET', '/repos/0/mirror/head'],
      ['POST', '/notifications/send'],
      ['DELETE', '/settings'],
      ['PUT', '/opencode-config'],
      ['DELETE', '/sessions/abc'],
      ['GET', '/multi-runs'],
      ['POST', '/multi-runs'],
      ['POST', '/multi-runs/1/fusions'],
      ['POST', '/multi-runs/1/entries/2/discard'],
      ['GET', '/outputs/x'],
      ['POST', '/outputs/x'],
      ['POST', '/outputs/x/refine'],
      ['DELETE', '/outputs/x'],
      ['GET', '/outputs/helper-sessions'],
      ['POST', '/output-actions/x/define'],
      ['POST', '/output-actions/x/input'],
      ['POST', '/output-actions/x/publish'],
      ['GET', '/output-definitions'],
      ['POST', '/output-definitions'],
    ] as const

    for (const [method, path] of deniedRoutes) {
      const fetchMock = jsonResponse({})
      vi.stubGlobal('fetch', fetchMock)

      await expect(runTool(tool, { action: 'request', params: { method, path } }))
        .rejects.toThrow(/is not an allowed OpenCode Manager route/)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('allows listing schedule worktrees but rejects deleting them', async () => {
    const tool = await loadTool(configHome)

    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    await runTool(tool, { action: 'request', params: { method: 'GET', path: '/repos/1/schedules/2/worktrees' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const deleteMock = jsonResponse({})
    vi.stubGlobal('fetch', deleteMock)
    await expect(runTool(tool, { action: 'request', params: { method: 'DELETE', path: '/repos/1/schedules/2/worktrees' } }))
      .rejects.toThrow(/is not an allowed OpenCode Manager route/)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('normalizes path traversal and rejects the resolved route without calling the API', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(
      runTool(tool, { action: 'request', params: { method: 'GET', path: '/repos/x/../../shell-env' } }),
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
          action: { type: 'string', enum: ['send_notification', 'request', 'open_output', 'show_artifact', 'define_output', 'read_output_input', 'publish_output'] },
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
              {
                type: 'object',
                required: ['definitionId'],
                additionalProperties: false,
                properties: {
                  definitionId: expect.anything(),
                  params: expect.anything(),
                },
              },
              {
                type: 'object',
                required: ['title', 'path'],
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: 120 },
                  path: { type: 'string', minLength: 1, maxLength: 1000 },
                },
              },
              {
                type: 'object',
                required: ['definition'],
                additionalProperties: false,
                properties: {
                  definition: expect.anything(),
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  file: { type: 'string', minLength: 1, maxLength: 1000 },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  definitionId: expect.anything(),
                  params: expect.anything(),
                  data: expect.anything(),
                  path: expect.anything(),
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
      expect(JSON.parse(request.body)).toEqual({
        title: 'Storm watch',
        body: 'Formation odds crossed 40%',
        priority: 'high',
        sessionId: expect.stringMatching(/^ses_/),
      })
      expect(toolResults.some((output) => output.includes('Notification sent: 1 delivered, 0 failed.'))).toBe(true)
    } finally {
      api.server.close()
      llm.server.close()
    }
  }, 120000)
})
