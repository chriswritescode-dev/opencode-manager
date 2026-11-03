import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildOpenCodeBasicAuth,
  createOpenCodeApi,
  type OpenCodeApi,
  type SessionMessageAssistantTool,
  type SessionMessageInfo,
  type V2Event,
} from '@opencode-manager/shared/opencode'
import { compareSemver } from '@opencode-manager/shared/utils'
import { getOpenCodePluginDir } from '../../src/services/opencode/plugin-registry'
import { readOpenCodeVersion, resolveOpenCode2Binary, startOpenCodeServe } from '../helpers/opencode-binary'
import type { OpenCodeServe } from '../helpers/opencode-binary'

const BINARY = resolveOpenCode2Binary()

const VERSION = BINARY === null ? null : readOpenCodeVersion(BINARY)

const REPAIRS_BASH = VERSION !== null && compareSemver(VERSION, '2.2.5') >= 0

const REPAIR_NOTE = 'There is no "bash" tool, so this ran as "shell". Call "shell" directly.'

const UNKNOWN_TOOL_NOTE = 'No tool named "bash" is currently available'

const BACKGROUND_COMMAND = 'sleep 1; echo bg-done; exit 4'

const SCENARIO_TIMEOUT_MS = 120000

const SETTLE_TIMEOUT_MS = 60000

const SETTLE_POLL_INTERVAL_MS = 100

const MOCK_MODEL_ID = 'mock-model'

type ShellInfo = Awaited<ReturnType<OpenCodeApi['shell']['list']>>['data'][number]

type Scenario = {
  name: string
  tool: 'bash' | 'shell'
  arguments: Record<string, unknown>
}

const SCENARIO_BASH_EXIT_0: Scenario = { name: 'bash-exit-0', tool: 'bash', arguments: { command: 'echo ok' } }

const SCENARIO_BASH_EXIT_NONZERO: Scenario = { name: 'bash-exit-nonzero', tool: 'bash', arguments: { command: 'echo no; exit 3' } }

const SCENARIO_BASH_ERROR: Scenario = { name: 'bash-error', tool: 'bash', arguments: {} }

const SCENARIO_BASH_BACKGROUND: Scenario = {
  name: 'bash-background',
  tool: 'bash',
  arguments: { command: BACKGROUND_COMMAND, background: true },
}

const SCENARIO_SHELL_EXIT_NONZERO: Scenario = { name: 'shell-exit-nonzero', tool: 'shell', arguments: { command: 'exit 5' } }

const SCENARIO_SHELL_BACKGROUND: Scenario = {
  name: 'shell-background',
  tool: 'shell',
  arguments: { command: BACKGROUND_COMMAND, background: true },
}

const DEFAULT_SCENARIOS: readonly Scenario[] = [
  SCENARIO_BASH_EXIT_0,
  SCENARIO_BASH_EXIT_NONZERO,
  SCENARIO_BASH_ERROR,
  SCENARIO_BASH_BACKGROUND,
  SCENARIO_SHELL_EXIT_NONZERO,
  SCENARIO_SHELL_BACKGROUND,
]

const SCENARIO_CUSTOM_BASH: Scenario = { name: 'custom-bash', tool: 'bash', arguments: { command: 'echo custom' } }

const CUSTOM_SCENARIOS: readonly Scenario[] = [SCENARIO_CUSTOM_BASH]

const CUSTOM_BASH_PLUGIN_SOURCE = `export default {
  id: 'ocm-custom-bash',
  async setup(ctx) {
    await ctx.tool.transform(function (editor) {
      editor.add({
        name: 'bash',
        description: 'Run a bash command.',
        input: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
        options: { codemode: false },
        execute: async function () {
          return { content: 'custom-bash-ran', metadata: { exit: 7, shellID: 'custom-fake', background: true } }
        },
      })
    })
  },
}
`

type ScenarioCapture = {
  events: V2Event[]
  messages: SessionMessageInfo[]
  shells: ShellInfo[]
  toolResults: string[]
}

type RecordedScenario = Omit<ScenarioCapture, 'toolResults'>

type Harness = {
  capture: (scenario: Scenario) => Promise<ScenarioCapture>
  dispose: () => Promise<void>
}

type FakeModel = {
  port: number
  toolResults: Map<string, string[]>
  close: () => void
}

type EventStream = {
  events: V2Event[]
  close: () => void
}

const TEMP_PATH_REPLACEMENTS: { path: string; replacement: string }[] = []

const RECORDED_SCENARIOS = new Map<string, RecordedScenario>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function metadataField(metadata: unknown, key: string): unknown {
  if (metadata === null || typeof metadata !== 'object') return undefined
  return (metadata as Record<string, unknown>)[key]
}

function metadataString(metadata: unknown, key: string): string | undefined {
  const value = metadataField(metadata, key)
  return typeof value === 'string' ? value : undefined
}

function metadataNumber(metadata: unknown, key: string): number | undefined {
  const value = metadataField(metadata, key)
  return typeof value === 'number' ? value : undefined
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  return JSON.stringify(content ?? null)
}

function toolContentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((entry) => (metadataField(entry, 'type') === 'text' ? String(metadataField(entry, 'text') ?? '') : ''))
    .join('\n')
}

function readScenario(body: string, scenarios: readonly Scenario[]): Scenario | undefined {
  const name = /SCENARIO:([a-z0-9-]+)/.exec(body)?.[1]
  if (name === undefined) return undefined
  return scenarios.find((scenario) => scenario.name === name)
}

function startFakeModel(scenarios: readonly Scenario[]): Promise<FakeModel> {
  const toolResults = new Map<string, string[]>()
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: MOCK_MODEL_ID, object: 'model' }] }))
      return
    }
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404)
      response.end()
      return
    }
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      const messages = (JSON.parse(body || '{}') as { messages?: { role?: string; content?: unknown }[] }).messages ?? []
      const toolMessages = messages.filter((message) => message.role === 'tool')
      const scenario = readScenario(body, scenarios)
      if (scenario) {
        const recorded = toolResults.get(scenario.name) ?? []
        recorded.push(...toolMessages.map((message) => toolResultText(message.content)))
        toolResults.set(scenario.name, recorded)
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const base = { id: 'chatcmpl-repaired-bash', object: 'chat.completion.chunk', created: 1, model: MOCK_MODEL_ID }
      const writeChunk = (chunk: unknown) => response.write(`data: ${JSON.stringify(chunk)}\n\n`)
      if (scenario && toolMessages.length === 0) {
        const call = { index: 0, id: 'call_1', type: 'function', function: { name: scenario.tool, arguments: '' } }
        writeChunk({
          ...base,
          choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: null }],
        })
        writeChunk({
          ...base,
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(scenario.arguments) } }] }, finish_reason: null }],
        })
        writeChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        writeChunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
        writeChunk({ ...base, choices: [{ index: 0, delta: { content: 'FINAL' }, finish_reason: null }] })
        writeChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      }
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as AddressInfo).port, toolResults, close: () => server.close() })
    })
  })
}

async function openEventStream(serve: OpenCodeServe): Promise<EventStream> {
  const controller = new AbortController()
  const response = await fetch(`${serve.baseUrl}/api/event`, {
    headers: { Authorization: buildOpenCodeBasicAuth(serve.password), Accept: 'text/event-stream' },
    signal: controller.signal,
  })
  if (!response.ok || !response.body) throw new Error(`event stream failed with status ${response.status}`)
  const events: V2Event[] = []
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
          events.push(JSON.parse(line.slice(5)) as V2Event)
        }
      }
    } catch {
      return
    }
  })()
  return { events, close: () => controller.abort() }
}

function createClient(serve: OpenCodeServe): OpenCodeApi {
  const authorization = buildOpenCodeBasicAuth(serve.password)
  return createOpenCodeApi({
    baseUrl: serve.baseUrl,
    fetch: ((input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', authorization)
      return fetch(input, { ...init, headers })
    }) as typeof fetch,
  })
}

function eventSessionID(event: V2Event): string | undefined {
  return metadataString(metadataField(event, 'data'), 'sessionID')
}

function messageMetadata(message: SessionMessageInfo): unknown {
  return metadataField(message, 'metadata')
}

async function waitForToolCall(stream: EventStream, from: number, sessionID: string): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const issued = stream.events
      .slice(from)
      .some((event) => event.type === 'session.tool.input.started' && eventSessionID(event) === sessionID)
    if (issued) return
    await delay(SETTLE_POLL_INTERVAL_MS)
  }
  throw new Error(`session ${sessionID} did not issue a tool call`)
}

async function waitForIdle(api: OpenCodeApi, sessionID: string): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const active = await api.session.active()
    if (active[sessionID] === undefined) return
    await delay(SETTLE_POLL_INTERVAL_MS)
  }
  throw new Error(`session ${sessionID} did not become idle`)
}

async function waitForShellNotice(api: OpenCodeApi, sessionID: string): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const page = await api.message.list({ sessionID, type: 'synthetic', order: 'desc' })
    if (page.data.some((message) => metadataString(messageMetadata(message), 'source') === 'shell')) return
    await delay(SETTLE_POLL_INTERVAL_MS)
  }
  throw new Error(`session ${sessionID} did not receive a shell terminal notice`)
}

async function captureScenario(input: {
  api: OpenCodeApi
  stream: EventStream
  model: FakeModel
  workDirectory: string
  scenario: Scenario
}): Promise<ScenarioCapture> {
  const { api, stream, model, workDirectory, scenario } = input
  const session = await api.session.create({ title: scenario.name, location: { directory: workDirectory } })
  const from = stream.events.length
  await api.session.prompt({ sessionID: session.id, text: `SCENARIO:${scenario.name}` })
  await waitForToolCall(stream, from, session.id)
  await waitForIdle(api, session.id)
  const startedShell = stream.events
    .slice(from)
    .some(
      (event) =>
        event.type === 'session.tool.success' &&
        metadataString(event.data.metadata, 'status') === 'running' &&
        metadataString(event.data.metadata, 'shellID') !== undefined,
    )
  if (startedShell) {
    await waitForShellNotice(api, session.id)
    await waitForIdle(api, session.id)
  }
  const page = await api.message.list({ sessionID: session.id, order: 'desc' })
  const shells = await api.shell.list({ location: { directory: workDirectory } })
  return {
    events: stream.events.slice(from).filter((event) => eventSessionID(event) === session.id),
    messages: [...page.data].reverse(),
    shells: shells.data,
    toolResults: model.toolResults.get(scenario.name) ?? [],
  }
}

async function startHarness(options: { scenarios: readonly Scenario[]; pluginSource?: string }): Promise<Harness> {
  const root = mkdtempSync(path.join(tmpdir(), 'ocm-repaired-bash-'))
  const configHome = path.join(root, 'config')
  const homeDirectory = path.join(root, 'home')
  for (const directory of [path.join(configHome, 'opencode'), homeDirectory, path.join(root, 'data'), path.join(root, 'state'), path.join(root, 'cache')]) {
    mkdirSync(directory, { recursive: true })
  }
  if (options.pluginSource) {
    const pluginDirectory = getOpenCodePluginDir(configHome)
    mkdirSync(pluginDirectory, { recursive: true })
    writeFileSync(path.join(pluginDirectory, 'custom-bash.js'), options.pluginSource)
  }
  const model = await startFakeModel(options.scenarios)
  writeFileSync(
    path.join(configHome, 'opencode', 'opencode.json'),
    JSON.stringify({
      providers: {
        mock: {
          package: '@opencode/ai/providers/openai-compatible',
          name: 'Mock',
          settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: 'mock-key' },
          models: { 'mock-model': { name: 'Mock Model' } },
        },
      },
      model: 'mock/mock-model',
      permissions: [{ action: '*', resource: '*', effect: 'allow' }],
    }),
  )
  const serve = await startOpenCodeServe({ env: { HOME: homeDirectory, XDG_CONFIG_HOME: configHome } })
  const api = createClient(serve)
  const stream = await openEventStream(serve)
  const workDirectory = mkdtempSync(path.join(tmpdir(), 'ocm-repaired-bash-work-'))
  TEMP_PATH_REPLACEMENTS.push(
    { path: workDirectory, replacement: '/workspace' },
    { path: serve.directories.root, replacement: '/workspace/.opencode-instance' },
  )
  const captures = new Map<string, ScenarioCapture>()

  return {
    capture: async (scenario) => {
      const cached = captures.get(scenario.name)
      if (cached) return cached
      const capture = await captureScenario({ api, stream, model, workDirectory, scenario })
      captures.set(scenario.name, capture)
      RECORDED_SCENARIOS.set(scenario.name, { events: capture.events, messages: capture.messages, shells: capture.shells })
      return capture
    },
    dispose: async () => {
      stream.close()
      await serve.stop()
      model.close()
      rmSync(workDirectory, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    },
  }
}

function toolInputStarted(events: V2Event[]): Extract<V2Event, { type: 'session.tool.input.started' }> | undefined {
  return events.find((event): event is Extract<V2Event, { type: 'session.tool.input.started' }> => event.type === 'session.tool.input.started')
}

function toolSuccess(events: V2Event[]): Extract<V2Event, { type: 'session.tool.success' }> | undefined {
  return events.find((event): event is Extract<V2Event, { type: 'session.tool.success' }> => event.type === 'session.tool.success')
}

function toolProgress(events: V2Event[]): Extract<V2Event, { type: 'session.tool.progress' }> | undefined {
  return events.find((event): event is Extract<V2Event, { type: 'session.tool.progress' }> => event.type === 'session.tool.progress')
}

function toolFailed(events: V2Event[]): Extract<V2Event, { type: 'session.tool.failed' }> | undefined {
  return events.find((event): event is Extract<V2Event, { type: 'session.tool.failed' }> => event.type === 'session.tool.failed')
}

function assistantToolPart(messages: SessionMessageInfo[]): SessionMessageAssistantTool {
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    for (const part of message.content) {
      if (part.type === 'tool') return part
    }
  }
  throw new Error('the recorded transcript has no assistant tool part')
}

function shellNotice(messages: SessionMessageInfo[]): Extract<SessionMessageInfo, { type: 'synthetic' }> {
  const notice = messages.find(
    (message): message is Extract<SessionMessageInfo, { type: 'synthetic' }> =>
      message.type === 'synthetic' && metadataString(messageMetadata(message), 'source') === 'shell',
  )
  if (!notice) throw new Error('the recorded transcript has no shell terminal notice')
  return notice
}

function completedState(part: SessionMessageAssistantTool): Extract<SessionMessageAssistantTool['state'], { status: 'completed' }> {
  if (part.state.status !== 'completed') throw new Error(`expected a completed ${part.name} call, received ${part.state.status}`)
  return part.state
}

function failedState(part: SessionMessageAssistantTool): Extract<SessionMessageAssistantTool['state'], { status: 'error' }> {
  if (part.state.status !== 'error') throw new Error(`expected a failed ${part.name} call, received ${part.state.status}`)
  return part.state
}

function expectModelSuppliedName(capture: ScenarioCapture, scenario: Scenario): SessionMessageAssistantTool {
  expect(toolInputStarted(capture.events)?.data.name).toBe(scenario.tool)
  const part = assistantToolPart(capture.messages)
  expect(part.name).toBe(scenario.tool)
  return part
}

function sanitizeRecorded(fixture: unknown): { version: string; scenarios: Record<string, RecordedScenario> } {
  let serialized = JSON.stringify(fixture)
  for (const replacement of TEMP_PATH_REPLACEMENTS) {
    serialized = serialized.split(replacement.path).join(replacement.replacement)
  }
  serialized = serialized.split(tmpdir()).join('/workspace/.tmp')
  return JSON.parse(serialized) as { version: string; scenarios: Record<string, RecordedScenario> }
}

describe.skipIf(BINARY === null)('model bash calls over the shipped OpenCode 2 binary', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ scenarios: DEFAULT_SCENARIOS })
  }, SCENARIO_TIMEOUT_MS)

  afterAll(async () => {
    await harness.dispose()
  })

  it.skipIf(!REPAIRS_BASH)(
    'runs a bash call through the built-in shell and reports its metadata',
    async () => {
      const capture = await harness.capture(SCENARIO_BASH_EXIT_0)
      const part = expectModelSuppliedName(capture, SCENARIO_BASH_EXIT_0)
      const state = completedState(part)
      expect(metadataNumber(state.metadata, 'exit')).toBe(0)
      expect(toolContentText(state.content)).toContain('ok')
      expect(capture.toolResults.some((result) => result.includes(REPAIR_NOTE))).toBe(true)
    },
    SCENARIO_TIMEOUT_MS,
  )

  it.skipIf(REPAIRS_BASH)(
    'fails a bash call with an unknown tool error when the version does not repair tool names',
    async () => {
      const capture = await harness.capture(SCENARIO_BASH_EXIT_0)
      const part = expectModelSuppliedName(capture, SCENARIO_BASH_EXIT_0)
      const state = failedState(part)
      expect(state.error.message).toContain(UNKNOWN_TOOL_NOTE)
      expect(metadataField(state.metadata, 'exit')).toBeUndefined()
      expect(metadataField(state.metadata, 'shellID')).toBeUndefined()
      expect(toolSuccess(capture.events)).toBeUndefined()
      expect(toolFailed(capture.events)?.data.error.message).toContain(UNKNOWN_TOOL_NOTE)
    },
    SCENARIO_TIMEOUT_MS,
  )

  it.skipIf(!REPAIRS_BASH)(
    'reports the shell exit status of a repaired bash call that exits non-zero',
    async () => {
      const capture = await harness.capture(SCENARIO_BASH_EXIT_NONZERO)
      const part = expectModelSuppliedName(capture, SCENARIO_BASH_EXIT_NONZERO)
      const state = completedState(part)
      expect(metadataNumber(state.metadata, 'exit')).toBe(3)
      expect(metadataString(state.metadata, 'shellID')).toBeUndefined()
      expect(metadataString(toolProgress(capture.events)?.data.metadata, 'shellID')).toBeTruthy()
      expect(toolContentText(state.content)).toContain('Exited with code 3')
      expect(capture.toolResults.some((result) => result.includes(REPAIR_NOTE))).toBe(true)
      expect(capture.toolResults.some((result) => result.includes('Exited with code 3'))).toBe(true)
    },
    SCENARIO_TIMEOUT_MS,
  )

  it.skipIf(REPAIRS_BASH)(
    'fails a bash call with an unknown tool error instead of running it',
    async () => {
      const capture = await harness.capture(SCENARIO_BASH_EXIT_NONZERO)
      const part = expectModelSuppliedName(capture, SCENARIO_BASH_EXIT_NONZERO)
      const state = failedState(part)
      expect(state.error.message).toContain(UNKNOWN_TOOL_NOTE)
      expect(metadataField(state.metadata, 'exit')).toBeUndefined()
      expect(metadataField(state.metadata, 'shellID')).toBeUndefined()
      expect(toolFailed(capture.events)?.data.error.message).toContain(UNKNOWN_TOOL_NOTE)
      expect(capture.toolResults.some((result) => result.includes('No tool named'))).toBe(true)
      expect(capture.toolResults.some((result) => result.includes(REPAIR_NOTE))).toBe(false)
    },
    SCENARIO_TIMEOUT_MS,
  )

  it.skipIf(!REPAIRS_BASH)(
    'rejects invalid arguments for a repaired bash call with the repair note in the error',
    async () => {
      const capture = await harness.capture(SCENARIO_BASH_ERROR)
      const part = expectModelSuppliedName(capture, SCENARIO_BASH_ERROR)
      const state = failedState(part)
      expect(state.error.message).toContain('Invalid arguments for tool "shell"')
      expect(state.error.message).toContain(REPAIR_NOTE)
      expect(toolFailed(capture.events)?.data.error.message).toContain(REPAIR_NOTE)
      expect(metadataNumber(state.metadata, 'exit')).toBeUndefined()
    },
    SCENARIO_TIMEOUT_MS,
  )

  it.skipIf(REPAIRS_BASH)(
    'rejects invalid arguments for a bash call before any repair exists',
    async () => {
      const capture = await harness.capture(SCENARIO_BASH_ERROR)
      const part = expectModelSuppliedName(capture, SCENARIO_BASH_ERROR)
      const state = failedState(part)
      expect(state.error.message).toContain(UNKNOWN_TOOL_NOTE)
      expect(capture.toolResults.some((result) => result.includes(REPAIR_NOTE))).toBe(false)
    },
    SCENARIO_TIMEOUT_MS,
  )

  it.skipIf(!REPAIRS_BASH)(
    'keeps a repaired background bash call running and receives the shell terminal notice',
    async () => {
      const capture = await harness.capture(SCENARIO_BASH_BACKGROUND)
      const part = expectModelSuppliedName(capture, SCENARIO_BASH_BACKGROUND)
      const state = completedState(part)
      expect(metadataString(state.metadata, 'status')).toBe('running')
      const shellID = metadataString(state.metadata, 'shellID')
      expect(shellID).toBeTruthy()
      expect(toolContentText(state.content)).toContain(REPAIR_NOTE)
      const notice = shellNotice(capture.messages)
      expect(metadataString(notice.metadata, 'shellID')).toBe(shellID)
      expect(metadataNumber(notice.metadata, 'exit')).toBe(4)
      expect(capture.toolResults.some((result) => result.includes(REPAIR_NOTE))).toBe(true)
    },
    SCENARIO_TIMEOUT_MS,
  )

  it.skipIf(REPAIRS_BASH)(
    'fails a background bash call before it can run and never notifies a shell',
    async () => {
      const capture = await harness.capture(SCENARIO_BASH_BACKGROUND)
      const part = expectModelSuppliedName(capture, SCENARIO_BASH_BACKGROUND)
      const state = failedState(part)
      expect(state.error.message).toContain(UNKNOWN_TOOL_NOTE)
      expect(metadataField(state.metadata, 'shellID')).toBeUndefined()
      expect(capture.messages.some((message) => message.type === 'synthetic')).toBe(false)
    },
    SCENARIO_TIMEOUT_MS,
  )

  it(
    'reports the shell exit status of a model shell call',
    async () => {
      const capture = await harness.capture(SCENARIO_SHELL_EXIT_NONZERO)
      const part = expectModelSuppliedName(capture, SCENARIO_SHELL_EXIT_NONZERO)
      const state = completedState(part)
      expect(metadataNumber(state.metadata, 'exit')).toBe(5)
      expect(metadataString(toolProgress(capture.events)?.data.metadata, 'shellID')).toBeTruthy()
      expect(toolContentText(state.content)).toContain('Exited with code 5')
      expect(capture.toolResults.some((result) => result.includes(REPAIR_NOTE))).toBe(false)
      expect(capture.toolResults.some((result) => result.includes('Exited with code 5'))).toBe(true)
    },
    SCENARIO_TIMEOUT_MS,
  )

  it(
    'keeps a background shell call running and receives its shell terminal notice',
    async () => {
      const capture = await harness.capture(SCENARIO_SHELL_BACKGROUND)
      const part = expectModelSuppliedName(capture, SCENARIO_SHELL_BACKGROUND)
      const state = completedState(part)
      expect(metadataString(state.metadata, 'status')).toBe('running')
      const shellID = metadataString(state.metadata, 'shellID')
      expect(shellID).toBeTruthy()
      const notice = shellNotice(capture.messages)
      expect(metadataString(notice.metadata, 'shellID')).toBe(shellID)
      expect(metadataNumber(notice.metadata, 'exit')).toBe(4)
    },
    SCENARIO_TIMEOUT_MS,
  )
})

describe.skipIf(BINARY === null)('plugin-provided bash tool over the shipped OpenCode 2 binary', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ scenarios: CUSTOM_SCENARIOS, pluginSource: CUSTOM_BASH_PLUGIN_SOURCE })
  }, SCENARIO_TIMEOUT_MS)

  afterAll(async () => {
    await harness.dispose()
  })

  it(
    'runs the plugin bash tool instead of repairing the call to the built-in shell',
    async () => {
      const capture = await harness.capture(SCENARIO_CUSTOM_BASH)
      const part = expectModelSuppliedName(capture, SCENARIO_CUSTOM_BASH)
      const state = completedState(part)
      expect(toolContentText(state.content)).toContain('custom-bash-ran')
      expect(metadataNumber(state.metadata, 'exit')).toBe(7)
      expect(metadataString(state.metadata, 'shellID')).toBe('custom-fake')
      expect(toolContentText(state.content)).not.toContain(REPAIR_NOTE)
      expect(capture.toolResults).toContain('custom-bash-ran')
      expect(capture.toolResults.some((result) => result.includes(REPAIR_NOTE))).toBe(false)
      expect(capture.messages.some((message) => message.type === 'synthetic')).toBe(false)
    },
    SCENARIO_TIMEOUT_MS,
  )
})

afterAll(() => {
  const directory = process.env.OCM_RECORD_REPAIRED_BASH_FIXTURES
  if (!directory || VERSION === null || RECORDED_SCENARIOS.size === 0) return
  mkdirSync(directory, { recursive: true })
  const fixture = sanitizeRecorded({ version: VERSION, scenarios: Object.fromEntries(RECORDED_SCENARIOS) })
  writeFileSync(path.join(directory, `opencode-${VERSION}.json`), `${JSON.stringify(fixture, null, 2)}\n`)
})
