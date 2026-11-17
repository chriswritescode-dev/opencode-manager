import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import path from 'path'
import { z } from 'zod'
import { buildOpenCodeBasicAuth, compareOpenCodeVersions, readSessionGoal } from '@opencode-manager/shared/opencode'
import { FetchOpenCodeClient } from '../../src/services/opencode/client'
import { OPENCODE_DIRECTORY_HEADER } from '../../src/services/opencode/upstream'
import {
  createOpenCodeServeDirectories,
  readOpenCodeVersion,
  resolveGoalProbeBinary,
  startOpenCodeServe,
} from '../helpers/opencode-binary'
import type { OpenCodeServe, OpenCodeServeDirectories } from '../helpers/opencode-binary'

const BINARY = resolveGoalProbeBinary()
const VERSION = BINARY ? readOpenCodeVersion(BINARY) : null
const RPC_SKIPS_ACTIVATION = VERSION !== null && compareOpenCodeVersions(VERSION, '2.2.7') >= 0
const SESSION_ID = 'ses_0000000000000000000000000'
const SLOW_PLUGIN_MS = 3000
const POLL_INTERVAL_MS = 100
const WAIT_TIMEOUT_MS = 30000

const EventSchema = z.object({
  type: z.string(),
  location: z.object({ directory: z.string() }).optional(),
}).loose()

const RpcErrorBodySchema = z.object({ type: z.string() }).loose()

const SLOW_PLUGIN_SOURCE = `export default {
  id: 'slow.plugin',
  async setup() {
    await new Promise((resolve) => setTimeout(resolve, 3000))
  },
}
`

type RecordedEvent = { type: string; directory: string | null; at: number }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T>(description: string, probe: () => Promise<T | undefined> | T | undefined): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function writeSlowPlugin(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'slow-plugin', version: '1.0.0', type: 'module', main: 'index.js' }))
  await writeFile(path.join(directory, 'index.js'), SLOW_PLUGIN_SOURCE)
}

describe.skipIf(BINARY === null)(`OpenCode ${VERSION ?? 'unknown'} cold-Location Goal RPC`, () => {
  let directories: OpenCodeServeDirectories
  let serve: OpenCodeServe
  let client: FetchOpenCodeClient
  let coldDirectory: string
  let recorded: RecordedEvent[]
  const controller = new AbortController()

  function findPluginUpdated(directory: string): RecordedEvent | undefined {
    return recorded.find((event) => event.type === 'plugin.updated' && event.directory === directory)
  }

  async function startEventRecorder(): Promise<void> {
    const response = await fetch(`${serve.baseUrl}/api/event`, {
      headers: { Authorization: buildOpenCodeBasicAuth(serve.password), Accept: 'text/event-stream' },
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`event stream failed with status ${response.status}`)
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
            let payload: unknown
            try {
              payload = JSON.parse(line.slice(5))
            } catch {
              continue
            }
            const event = EventSchema.safeParse(payload)
            if (!event.success) continue
            recorded.push({ type: event.data.type, directory: event.data.location?.directory ?? null, at: Date.now() })
          }
        }
      } catch {
        return
      }
    })()
  }

  beforeAll(async () => {
    if (BINARY === null) throw new Error('no OpenCode binary is available for the cold-Location Goal RPC probe')
    directories = await createOpenCodeServeDirectories()
    recorded = []
    coldDirectory = path.join(directories.root, 'cold-location')
    const configDirectory = path.join(directories.configHome, 'opencode')
    const pluginDirectory = path.join(directories.root, 'slow-plugin')
    await mkdir(configDirectory, { recursive: true })
    await writeSlowPlugin(pluginDirectory)
    await writeFile(path.join(configDirectory, 'opencode.json'), JSON.stringify({ plugins: [pluginDirectory] }))
    serve = await startOpenCodeServe({ binary: BINARY, directories, env: { OPENCODE_DISABLE_FILEWATCHER: '1' } })
    client = new FetchOpenCodeClient({
      baseUrl: serve.baseUrl,
      basicAuth: buildOpenCodeBasicAuth(serve.password),
      defaultDirectory: false,
    })
    await startEventRecorder()
  }, 120000)

  afterAll(async () => {
    controller.abort()
    if (serve) await serve.terminate()
    if (directories) await rm(directories.root, { recursive: true, force: true })
  })

  it('answers the first Goal read on a cold Location', async () => {
    try {
      await mkdir(coldDirectory, { recursive: true })
      const startedAt = Date.now()
      const result = await readSessionGoal(client.api, { sessionID: SESSION_ID, directory: coldDirectory })
      const duration = Date.now() - startedAt
      if (RPC_SKIPS_ACTIVATION) {
        expect(result).toEqual({ supported: false })
        expect(duration).toBeLessThan(SLOW_PLUGIN_MS / 2)

        const rawDirectory = path.join(directories.root, 'cold-location-raw')
        await mkdir(rawDirectory, { recursive: true })
        const response = await fetch(`${serve.baseUrl}/api/rpc/opencode.goal/get`, {
          method: 'POST',
          headers: {
            Authorization: buildOpenCodeBasicAuth(serve.password),
            'content-type': 'application/json',
            [OPENCODE_DIRECTORY_HEADER]: encodeURIComponent(rawDirectory),
          },
          body: JSON.stringify({ input: { sessionID: SESSION_ID } }),
        })
        const text = await response.text()
        expect(response.status).toBe(400)
        expect(RpcErrorBodySchema.parse(JSON.parse(text)).type).toBe('rpc.unavailable')
      } else {
        expect(result).toEqual({ supported: true, goal: null })
        expect(duration).toBeGreaterThanOrEqual(SLOW_PLUGIN_MS - 500)
      }
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serve.readOutput()}`, { cause: error })
    }
  }, 120000)

  it('makes the Goal readable and publishes plugin.updated for the directory', async () => {
    const pollStartedAt = Date.now()
    let goalReadableAt: number | undefined
    try {
      if (RPC_SKIPS_ACTIVATION) {
        await waitFor('the cold Location Goal to become readable', async () => {
          const polled = await readSessionGoal(client.api, { sessionID: SESSION_ID, directory: coldDirectory })
          if (!polled.supported) return undefined
          goalReadableAt = Date.now()
          return polled
        })
      }

      const pluginUpdated = await waitFor('a plugin.updated event for the cold Location', () => findPluginUpdated(coldDirectory))
      expect(await readSessionGoal(client.api, { sessionID: SESSION_ID, directory: coldDirectory })).toEqual({ supported: true, goal: null })

      if (RPC_SKIPS_ACTIVATION) {
        if (goalReadableAt === undefined) throw new Error('the Goal was never observed as readable')
        if (goalReadableAt > pluginUpdated.at) {
          throw new Error(
            `the Goal became readable at ${goalReadableAt} but plugin.updated for the directory arrived earlier at ${pluginUpdated.at} (polling started at ${pollStartedAt})`,
          )
        }
        expect(goalReadableAt).toBeLessThanOrEqual(pluginUpdated.at)
      }
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serve.readOutput()}`, { cause: error })
    }
  }, 120000)

  it('restores the Goal read after a location reload', async () => {
    try {
      await client.api.location.reload({ headers: { [OPENCODE_DIRECTORY_HEADER]: encodeURIComponent(coldDirectory) } })
      const immediateStartedAt = Date.now()
      const immediate = await readSessionGoal(client.api, { sessionID: SESSION_ID, directory: coldDirectory })
      const immediateDuration = Date.now() - immediateStartedAt
      if (RPC_SKIPS_ACTIVATION) {
        const readable = await waitFor('the Goal to be readable after the location reload', async () => {
          const read = await readSessionGoal(client.api, { sessionID: SESSION_ID, directory: coldDirectory })
          return read.supported ? read : undefined
        })
        expect(readable).toEqual({ supported: true, goal: null })
      } else {
        expect(immediate).toEqual({ supported: true, goal: null })
        expect(immediateDuration).toBeGreaterThanOrEqual(SLOW_PLUGIN_MS - 500)
      }
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serve.readOutput()}`, { cause: error })
    }
  }, 120000)
})
