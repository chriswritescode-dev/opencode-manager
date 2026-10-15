import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { BASE_URL, E2E_TMP, STORAGE_STATE } from './env'

const MOCK_MODEL_ID = 'mock-model'
const TITLE_SYSTEM_PREFIX = 'You are a title generator.'
const MOCK_TITLE = 'Mock Session Title'

export const TOOL_FOLLOW_UP_TEXT = 'The requested command has finished.'

export interface MockProvider {
  setReply(text: string): void
  setStreamReply(trigger: string, chunks: string[], delayMs: number): void
  setToolCallReply(trigger: string, toolName: string, input: Record<string, unknown>): void
  close(): Promise<void>
}

export interface MockRepo {
  id: number
  fullPath: string
  sessionId: string
}

export interface CreateMockRepoOptions {
  beforeCommit?: (directory: string) => void
  config?: Record<string, unknown>
}

interface ChatMessage {
  role?: string
  content?: unknown
}

interface StreamReply {
  chunks: string[]
  delayMs: number
}

interface ToolCallReply {
  toolName: string
  input: Record<string, unknown>
}

type ResolvedReply =
  | { kind: 'text'; text: string }
  | { kind: 'stream'; chunks: string[]; delayMs: number }
  | { kind: 'tool'; toolName: string; input: Record<string, unknown> }

interface ReplyState {
  defaultReply: string
  streamReplies: Map<string, StreamReply>
  toolCallReplies: Map<string, ToolCallReply>
}

const USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function messageText(message: ChatMessage | undefined): string {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((part) =>
      part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : '',
    )
    .join('')
}

function resolveReply(body: { messages?: ChatMessage[] }, state: ReplyState): ResolvedReply {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const system = messages.find((message) => message.role === 'system')
  if (messageText(system).startsWith(TITLE_SYSTEM_PREFIX)) {
    return { kind: 'text', text: MOCK_TITLE }
  }
  const last = messages[messages.length - 1]
  if (last?.role === 'tool') {
    return { kind: 'text', text: TOOL_FOLLOW_UP_TEXT }
  }
  const userText = messageText([...messages].reverse().find((message) => message.role === 'user'))
  const stream = [...state.streamReplies.entries()].find(([trigger]) => userText.includes(trigger))
  if (stream) return { kind: 'stream', ...stream[1] }
  const toolCall = [...state.toolCallReplies.entries()].find(([trigger]) => userText.includes(trigger))
  if (toolCall) return { kind: 'tool', ...toolCall[1] }
  return { kind: 'text', text: state.defaultReply }
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => resolve(''))
  })
}

function openStream(response: http.ServerResponse): {
  event: (payload: unknown) => boolean
  raw: (data: string) => boolean
} {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const alive = () => !response.destroyed && !response.writableEnded
  return {
    event: (payload) => {
      if (!alive()) return false
      response.write(`data: ${JSON.stringify(payload)}\n\n`)
      return true
    },
    raw: (data) => {
      if (!alive()) return false
      response.write(`data: ${data}\n\n`)
      return true
    },
  }
}

function sendJson(response: http.ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function completionChunk(delta: Record<string, unknown>, finishReason: string | null, withUsage = false) {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MOCK_MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(withUsage ? { usage: USAGE } : {}),
  }
}

async function sendReply(
  response: http.ServerResponse,
  reply: ResolvedReply,
  stream: boolean,
): Promise<void> {
  if (reply.kind === 'text') {
    if (!stream) {
      sendJson(response, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: MOCK_MODEL_ID,
        choices: [{ index: 0, message: { role: 'assistant', content: reply.text }, finish_reason: 'stop' }],
        usage: USAGE,
      })
      return
    }
    const sse = openStream(response)
    sse.event(completionChunk({ role: 'assistant', content: '' }, null))
    sse.event(completionChunk({ content: reply.text }, null))
    sse.event(completionChunk({}, 'stop', true))
    sse.raw('[DONE]')
    response.end()
    return
  }

  if (reply.kind === 'stream') {
    if (!stream) {
      sendJson(response, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: MOCK_MODEL_ID,
        choices: [
          { index: 0, message: { role: 'assistant', content: reply.chunks.join('') }, finish_reason: 'stop' },
        ],
        usage: USAGE,
      })
      return
    }
    const sse = openStream(response)
    sse.event(completionChunk({ role: 'assistant', content: '' }, null))
    for (const [index, chunk] of reply.chunks.entries()) {
      if (index > 0) await delay(reply.delayMs)
      if (!sse.event(completionChunk({ content: chunk }, null))) return
    }
    if (!sse.event(completionChunk({}, 'stop', true))) return
    sse.raw('[DONE]')
    response.end()
    return
  }

  const toolCall = {
    id: 'call_mock_1',
    type: 'function',
    function: { name: reply.toolName, arguments: JSON.stringify(reply.input) },
  }
  if (!stream) {
    sendJson(response, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MOCK_MODEL_ID,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null, tool_calls: [toolCall] },
          finish_reason: 'tool_calls',
        },
      ],
      usage: USAGE,
    })
    return
  }
  const sse = openStream(response)
  sse.event(completionChunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, ...toolCall }] }, null))
  sse.event(completionChunk({}, 'tool_calls', true))
  sse.raw('[DONE]')
  response.end()
}

async function handleMockRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  state: ReplyState,
): Promise<void> {
  const url = request.url ?? ''
  if (request.method === 'GET' && url.startsWith('/v1/models')) {
    sendJson(response, {
      object: 'list',
      data: [{ id: MOCK_MODEL_ID, object: 'model', created: 0, owned_by: 'mock' }],
    })
    return
  }

  if (request.method === 'POST' && url.startsWith('/v1/chat/completions')) {
    const raw = await readBody(request)
    let body: { stream?: boolean; messages?: ChatMessage[] } = {}
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      body = {}
    }
    await sendReply(response, resolveReply(body, state), body.stream === true)
    return
  }

  sendJson(response, { error: { message: `unhandled ${request.method} ${url}` } }, 404)
}

export async function startMockProvider(port: number): Promise<MockProvider> {
  const state: ReplyState = {
    defaultReply: '',
    streamReplies: new Map(),
    toolCallReplies: new Map(),
  }
  const server = http.createServer((request, response) => {
    response.on('error', () => {})
    void handleMockRequest(request, response, state).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' })
      }
      response.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  return {
    setReply: (text) => {
      state.defaultReply = text
    },
    setStreamReply: (trigger, chunks, delayMs) => {
      state.streamReplies.set(trigger, { chunks, delayMs })
    },
    setToolCallReply: (trigger, toolName, input) => {
      state.toolCallReplies.set(trigger, { toolName, input })
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

async function waitForConfiguredModel(api: APIRequestContext, directory: string): Promise<void> {
  const query = new URLSearchParams({ 'location[directory]': directory })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await api.get(`/api/opencode/api/config?${query.toString()}`)
    if (response.ok() && (await response.text()).includes(MOCK_MODEL_ID)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`mock model was not configured for ${directory}`)
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
        ...options.config,
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
    await waitForConfiguredModel(api, repo.fullPath)
    const sessionId = await createSession(api, repo.fullPath)
    return { id: repo.id, fullPath: repo.fullPath, sessionId }
  } finally {
    await api.dispose()
  }
}
