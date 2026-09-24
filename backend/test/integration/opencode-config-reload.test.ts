import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'http'
import type { IncomingMessage, Server, ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { mkdir, rm, writeFile } from 'fs/promises'
import path from 'path'
import { buildOpenCodeBasicAuth } from '@opencode-manager/shared/opencode'
import { FetchOpenCodeClient } from '../../src/services/opencode/client'
import { OPENCODE_DIRECTORY_HEADER } from '../../src/services/opencode/upstream'
import {
  createOpenCodeServeDirectories,
  resolveOpenCode2Binary,
  startOpenCodeServe,
} from '../helpers/opencode-binary'
import type { OpenCodeServe, OpenCodeServeDirectories } from '../helpers/opencode-binary'

const OPENCODE_BIN = resolveOpenCode2Binary()
const POLL_INTERVAL_MS = 250
const WAIT_TIMEOUT_MS = 30000
const WATCHER_SETTLE_MS = 1500
const MOCK_MODEL_CAPABILITIES = { tools: true, input: ['text'], output: ['text'] }
const GLOBAL_AGENTS_MARKER = 'GLOBAL_AGENTS_MARKER_7781'

type CompletionRequest = { headers: IncomingMessage['headers']; body: { model?: string; tools?: Array<{ function?: { name?: string } }> } }

type MockLlm = {
  port: number
  requests: CompletionRequest[]
  hold: (enabled: boolean) => void
  releaseHeld: () => void
  heldCount: () => number
  close: () => Promise<void>
}

const CHUNK_BASE = { id: 'chatcmpl-reload', object: 'chat.completion.chunk', created: 1, model: 'mock-model' }

function writeChunk(res: ServerResponse, delta: Record<string, unknown>, finishReason: string | null): void {
  res.write(`data: ${JSON.stringify({ ...CHUNK_BASE, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`)
}

function finishCompletion(res: ServerResponse): void {
  writeChunk(res, { content: 'done' }, 'stop')
  res.write('data: [DONE]\n\n')
  res.end()
}

async function startMockLlm(): Promise<MockLlm> {
  const requests: CompletionRequest[] = []
  const held = new Set<ServerResponse>()
  let holding = false
  const server: Server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404)
      res.end()
      return
    }
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString()
    })
    req.on('end', () => {
      const body = JSON.parse(raw) as CompletionRequest['body']
      requests.push({ headers: req.headers, body })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      writeChunk(res, { role: 'assistant', content: 'partial ' }, null)
      if (holding && body.tools) {
        held.add(res)
        res.on('close', () => held.delete(res))
        return
      }
      finishCompletion(res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    hold: (enabled) => {
      holding = enabled
    },
    releaseHeld: () => {
      for (const res of held) finishCompletion(res)
      held.clear()
    },
    heldCount: () => held.size,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T>(description: string, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

function mockProvider(port: number, pathSuffix: string, models: Record<string, unknown>, settings: Record<string, unknown> = {}) {
  return {
    package: '@opencode/ai/providers/openai-compatible',
    name: `Mock ${pathSuffix}`,
    settings: { baseURL: `http://127.0.0.1:${port}/${pathSuffix}`, apiKey: 'mock-key', ...settings },
    models,
  }
}

function buildBaseConfig(port: number): Record<string, unknown> {
  return {
    providers: {
      mock: mockProvider(port, 'v1', { 'mock-model': { name: 'Mock Model', capabilities: MOCK_MODEL_CAPABILITIES } }),
    },
    model: 'mock/mock-model',
    permissions: [{ action: '*', resource: '*', effect: 'allow' }],
  }
}

function buildReloadedConfig(port: number, pluginDirectory: string): Record<string, unknown> {
  return {
    providers: {
      mock: mockProvider(
        port,
        'v1',
        {
          'mock-model': { name: 'Mock Model', capabilities: MOCK_MODEL_CAPABILITIES },
          'mock-alt': { name: 'Mock Alt', capabilities: MOCK_MODEL_CAPABILITIES },
        },
        { headers: { 'x-reload-probe': 'applied' } },
      ),
      custom: mockProvider(port, 'v2', { 'custom-model': { name: 'Custom Model', capabilities: MOCK_MODEL_CAPABILITIES } }),
    },
    model: 'mock/mock-alt',
    agents: { reviewer: { description: 'Reviews changes', prompt: 'You review changes.' } },
    permissions: [
      { action: '*', resource: '*', effect: 'allow' },
      { action: 'webfetch', resource: '*', effect: 'deny' },
    ],
    plugins: [pluginDirectory],
  }
}

const PROBE_PLUGIN_SOURCE = `export default {
  id: 'probe.plugin',
  async setup(ctx) {
    await ctx.tool.transform(function (editor) {
      editor.add({
        name: 'probe_tool',
        description: 'Reload probe tool',
        input: { type: 'object', properties: {} },
        options: { codemode: false },
        execute: async function () {
          return { content: 'probe' }
        },
      })
    })
  },
}
`

async function writeProbePlugin(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'probe-plugin', version: '1.0.0', type: 'module', main: 'index.js' }))
  await writeFile(path.join(directory, 'index.js'), PROBE_PLUGIN_SOURCE)
}

async function writeConfigDirectoryFiles(configDirectory: string, projectDirectory: string): Promise<void> {
  await mkdir(path.join(configDirectory, 'agents'), { recursive: true })
  await writeFile(path.join(configDirectory, 'agents', 'mdagent.md'), '---\ndescription: Markdown agent\n---\nYou are a markdown agent.\n')
  await mkdir(path.join(configDirectory, 'commands'), { recursive: true })
  await writeFile(path.join(configDirectory, 'commands', 'mdcmd.md'), '---\ndescription: Markdown command\n---\nRun the markdown command.\n')
  await mkdir(path.join(configDirectory, 'skills', 'globalskill'), { recursive: true })
  await writeFile(path.join(configDirectory, 'skills', 'globalskill', 'SKILL.md'), '---\nname: globalskill\ndescription: Global skill\n---\nGlobal skill body.\n')
  await writeFile(path.join(configDirectory, 'AGENTS.md'), `${GLOBAL_AGENTS_MARKER}\n`)
  await mkdir(path.join(projectDirectory, '.opencode', 'skills', 'projectskill'), { recursive: true })
  await writeFile(path.join(projectDirectory, '.opencode', 'skills', 'projectskill', 'SKILL.md'), '---\nname: projectskill\ndescription: Project skill\n---\nProject skill body.\n')
}

describe.skipIf(OPENCODE_BIN === null)('OpenCode 2 location reload applies configuration changes without a restart', () => {
  let directories: OpenCodeServeDirectories
  let serve: OpenCodeServe
  let llm: MockLlm
  let client: FetchOpenCodeClient
  let workspace: string
  let otherLocation: string
  let configDirectory: string
  let pluginDirectory: string

  async function requestJson<T>(directory: string, pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${serve.baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: buildOpenCodeBasicAuth(serve.password),
        'content-type': 'application/json',
        [OPENCODE_DIRECTORY_HEADER]: encodeURIComponent(directory),
      },
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} failed with ${response.status}: ${text}`)
    return (text ? JSON.parse(text) : undefined) as T
  }

  async function listIds(directory: string, pathname: string): Promise<string[]> {
    const body = await requestJson<{ data: Array<{ id?: string; name?: string }> }>(directory, pathname)
    return body.data.map((entry) => entry.id ?? entry.name ?? '')
  }

  async function readLoadedAgents(directory: string): Promise<string[]> {
    return waitFor(`agents to load in ${directory}`, async () => {
      const agents = await listIds(directory, '/api/agent')
      return agents.length > 0 ? agents : undefined
    })
  }

  async function reloadWorkspaceLocation(): Promise<void> {
    await client.api.location.reload({ headers: { [OPENCODE_DIRECTORY_HEADER]: encodeURIComponent(workspace) } })
  }

  async function promptAndCaptureToolRequest(directory: string): Promise<{ sessionID: string; request: CompletionRequest }> {
    const session = await requestJson<{ data: { id: string } }>(directory, '/api/session', {
      method: 'POST',
      body: JSON.stringify({ location: { directory } }),
    })
    const firstRequest = llm.requests.length
    await requestJson(directory, `/api/session/${session.data.id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
    })
    const request = await waitFor('a completion request that offers tools', async () =>
      llm.requests.slice(firstRequest).find((candidate) => candidate.body.tools !== undefined),
    )
    return { sessionID: session.data.id, request }
  }

  function toolNames(request: CompletionRequest): string[] {
    return (request.body.tools ?? []).map((tool) => tool.function?.name ?? '')
  }

  beforeAll(async () => {
    directories = await createOpenCodeServeDirectories()
    workspace = path.join(directories.root, 'workspace')
    otherLocation = path.join(directories.root, 'other-repo')
    configDirectory = path.join(directories.configHome, 'opencode')
    pluginDirectory = path.join(directories.root, 'probe-plugin')
    await mkdir(workspace, { recursive: true })
    await mkdir(otherLocation, { recursive: true })
    await mkdir(configDirectory, { recursive: true })
    await writeProbePlugin(pluginDirectory)
    llm = await startMockLlm()
    await writeFile(path.join(configDirectory, 'opencode.json'), JSON.stringify(buildBaseConfig(llm.port)))
    serve = await startOpenCodeServe({ directories, env: { OPENCODE_DISABLE_FILEWATCHER: '1' } })
    client = new FetchOpenCodeClient({ baseUrl: serve.baseUrl, basicAuth: buildOpenCodeBasicAuth(serve.password) })
  }, 120000)

  afterAll(async () => {
    llm?.releaseHeld()
    if (serve) await serve.terminate()
    await llm?.close()
    if (directories) await rm(directories.root, { recursive: true, force: true })
  })

  it('applies agents, permissions, providers, models, plugins, and config directory files to every loaded location', async () => {
    try {
      expect(await readLoadedAgents(workspace)).not.toContain('reviewer')
      expect(await readLoadedAgents(otherLocation)).not.toContain('reviewer')
      const baseline = await promptAndCaptureToolRequest(workspace)
      expect(toolNames(baseline.request)).toContain('webfetch')
      expect(toolNames(baseline.request)).not.toContain('probe_tool')

      await writeFile(path.join(configDirectory, 'opencode.json'), JSON.stringify(buildReloadedConfig(llm.port, pluginDirectory)))
      await writeConfigDirectoryFiles(configDirectory, otherLocation)
      await delay(WATCHER_SETTLE_MS)
      expect(await listIds(workspace, '/api/agent')).not.toContain('reviewer')

      await reloadWorkspaceLocation()

      const workspaceAgents = await waitFor('the reloaded workspace agents', async () => {
        const agents = await listIds(workspace, '/api/agent')
        return agents.includes('reviewer') ? agents : undefined
      })
      expect(workspaceAgents).toEqual(expect.arrayContaining(['reviewer', 'mdagent']))

      const otherAgents = await waitFor('the other location to see the reloaded agents', async () => {
        const agents = await listIds(otherLocation, '/api/agent')
        return agents.includes('reviewer') ? agents : undefined
      })
      expect(otherAgents).toEqual(expect.arrayContaining(['reviewer', 'mdagent']))

      const plugins = await requestJson<{ data: Array<{ id: string; state: { status: string } }> }>(workspace, '/api/plugin')
      expect(plugins.data.find((plugin) => plugin.id === 'probe.plugin')?.state.status).toBe('active')

      const models = JSON.stringify(await requestJson<unknown>(workspace, '/api/model'))
      expect(models).toContain('"providerID":"custom"')
      const defaultModel = await requestJson<{ data: { id: string; providerID: string } }>(workspace, '/api/model/default')
      expect(defaultModel.data).toMatchObject({ id: 'mock-alt', providerID: 'mock' })

      expect(JSON.stringify(await requestJson<unknown>(workspace, '/api/command'))).toContain('mdcmd')
      expect(JSON.stringify(await requestJson<unknown>(workspace, '/api/skill'))).toContain('globalskill')
      expect(JSON.stringify(await requestJson<unknown>(otherLocation, '/api/skill'))).toContain('projectskill')

      const reloaded = await promptAndCaptureToolRequest(workspace)
      expect(toolNames(reloaded.request)).toContain('probe_tool')
      expect(toolNames(reloaded.request)).not.toContain('webfetch')
      expect(reloaded.request.body.model).toBe('mock-alt')
      expect(reloaded.request.headers['x-reload-probe']).toBe('applied')
      expect(JSON.stringify(reloaded.request.body)).toContain(GLOBAL_AGENTS_MARKER)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serve.readOutput()}`, { cause: error })
    }
  }, 180000)

  it('keeps an in-flight session running across a location reload', async () => {
    try {
      llm.hold(true)
      const { sessionID } = await promptAndCaptureToolRequest(workspace)
      await waitFor('the held completion', async () => (llm.heldCount() > 0 ? true : undefined))

      await reloadWorkspaceLocation()
      await delay(WATCHER_SETTLE_MS)

      const active = await requestJson<{ data: Record<string, unknown> }>(workspace, '/api/session/active')
      expect(Object.keys(active.data)).toContain(sessionID)
      expect(llm.heldCount()).toBe(1)

      llm.hold(false)
      llm.releaseHeld()

      const messages = await waitFor('the session to finish its held turn', async () => {
        const body = await requestJson<{ data: Array<{ type: string; outcome?: string; content?: Array<{ text?: string }> }> }>(
          workspace,
          `/api/session/${sessionID}/message`,
        )
        return body.data.some((message) => message.type === 'idle') ? body.data : undefined
      })
      expect(messages.find((message) => message.type === 'idle')?.outcome).toBe('succeeded')
      const assistantText = messages.filter((message) => message.type === 'assistant').flatMap((message) => message.content ?? []).map((part) => part.text).join('')
      expect(assistantText).toBe('partial done')
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serve.readOutput()}`, { cause: error })
    } finally {
      llm.hold(false)
      llm.releaseHeld()
    }
  }, 120000)
})
