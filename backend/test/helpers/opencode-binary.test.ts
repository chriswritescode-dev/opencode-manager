import { describe, it, expect, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'fs/promises'
import { vi } from 'vitest'
import os from 'os'
import path from 'path'
import { OPENCODE_SERVER_USERNAME } from '@opencode-manager/shared/opencode'
import { openCodeBinaryCandidates, resolveOpenCode2Binary, startOpenCodeServe, type ServeSpawn } from './opencode-binary'

const SUPPORTED_VERSION = '2.2.5'
const PATH_CANDIDATE = 'opencode'
const ABSOLUTE_CANDIDATES = ['/usr/local/bin/opencode', '/opt/opencode/bin/opencode']

describe('opencode-binary helpers', () => {
  let root: string
  let originalBin: string | undefined
  let child: ChildProcess | undefined

  afterEach(async () => {
    if (originalBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = originalBin
    vi.restoreAllMocks()
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
    child = undefined
    if (root) await rm(root, { recursive: true, force: true })
  })

  describe('resolveOpenCode2Binary', () => {
    it('returns the 2.x OPENCODE_BIN without probing further candidates', async () => {
      root = await mkdtemp(path.join(os.tmpdir(), 'ocm-binary-'))
      process.env.OPENCODE_BIN = path.join(root, 'opencode-2')
      const probed: string[] = []

      const resolved = resolveOpenCode2Binary(openCodeBinaryCandidates(), (binary) => {
        probed.push(binary)
        return SUPPORTED_VERSION
      })

      expect(resolved).toBe(process.env.OPENCODE_BIN)
      expect(probed).toEqual([process.env.OPENCODE_BIN])
    })

    it('falls through a rejected 1.x OPENCODE_BIN to an available 2.x candidate', async () => {
      root = await mkdtemp(path.join(os.tmpdir(), 'ocm-binary-'))
      process.env.OPENCODE_BIN = path.join(root, 'opencode-1')
      const versionsByBinary = new Map<string, string>([
        [process.env.OPENCODE_BIN, '1.18.32'],
        ['/usr/local/bin/opencode', SUPPORTED_VERSION],
      ])
      const probed: string[] = []

      const resolved = resolveOpenCode2Binary(openCodeBinaryCandidates(), (binary) => {
        probed.push(binary)
        return versionsByBinary.get(binary) ?? null
      })

      expect(resolved).toBe('/usr/local/bin/opencode')
      expect(probed).toEqual([process.env.OPENCODE_BIN, PATH_CANDIDATE, '/usr/local/bin/opencode'])
    })

    it('returns null when every candidate is missing or unsupported', async () => {
      root = await mkdtemp(path.join(os.tmpdir(), 'ocm-binary-'))
      process.env.OPENCODE_BIN = path.join(root, 'missing')
      const versionsByBinary = new Map<string, string>([['/opt/opencode/bin/opencode', '1.18.32']])
      const probed: string[] = []

      const resolved = resolveOpenCode2Binary(openCodeBinaryCandidates(), (binary) => {
        probed.push(binary)
        return versionsByBinary.get(binary) ?? null
      })

      expect(resolved).toBeNull()
      expect(probed).toEqual([process.env.OPENCODE_BIN, PATH_CANDIDATE, ...ABSOLUTE_CANDIDATES])
    })
  })

  describe('startOpenCodeServe', () => {
    it('keeps the generated password authoritative over an OPENCODE_SERVER_PASSWORD passed in env', async () => {
      root = await mkdtemp(path.join(os.tmpdir(), 'ocm-binary-'))
      child = spawn('sleep', ['60'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let spawnOptions: { env: NodeJS.ProcessEnv } | undefined
      const spawnProcess: ServeSpawn = (_binary, _args, options) => {
        spawnOptions = { env: options.env ?? {} }
        return child!
      }
      const requests: Array<{ url: string; authorization: string | undefined }> = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const authorization = new Headers(init?.headers).get('Authorization') ?? undefined
        requests.push({ url: String(input), authorization })
        return new Response('{}', { status: 200 })
      })

      const callerHome = path.join(root, 'caller-home')
      const callerConfigHome = path.join(root, 'caller-config')
      const serve = await startOpenCodeServe({
        binary: path.join(root, 'opencode-2'),
        spawnProcess,
        env: {
          HOME: callerHome,
          XDG_CONFIG_HOME: callerConfigHome,
          OPENCODE_SERVER_PASSWORD: 'caller-supplied-password',
        },
      })

      expect(spawnOptions?.env.OPENCODE_SERVER_PASSWORD).toBe(serve.password)
      expect(serve.password.length).toBeGreaterThan(0)
      expect(serve.password).not.toBe('caller-supplied-password')
      expect(serve.homeDirectory).toBe(callerHome)
      expect(serve.configHome).toBe(callerConfigHome)
      expect(spawnOptions?.env.HOME).toBe(callerHome)
      expect(spawnOptions?.env.XDG_CONFIG_HOME).toBe(callerConfigHome)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe(`${serve.baseUrl}/api/info`)
      const authorization = requests[0]?.authorization ?? ''
      expect(authorization.startsWith('Basic ')).toBe(true)
      expect(Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8')).toBe(`${OPENCODE_SERVER_USERNAME}:${serve.password}`)

      await serve.stop()
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    })
  })
})
