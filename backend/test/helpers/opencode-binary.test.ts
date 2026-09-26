import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { OPENCODE_SERVER_USERNAME } from '@opencode-manager/shared/opencode'
import { resolveOpenCode2Binary, startOpenCodeServe } from './opencode-binary'

const childProcessMock = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawnSync: childProcessMock.spawnSync,
  spawn: childProcessMock.spawn,
}))

const SUPPORTED_VERSION = '2.0.15'
const OPENCODE_BIN_FIXTURE = '/fixture/opencode-2'
const PATH_CANDIDATE = 'opencode'
const ABSOLUTE_CANDIDATES = ['/usr/local/bin/opencode', '/opt/opencode/bin/opencode']

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill: ReturnType<typeof vi.fn>
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    child.exitCode = signal === 'SIGKILL' ? 137 : 0
    setImmediate(() => child.emit('close', child.exitCode, signal ?? null))
    return true
  })
  return child
}

describe('opencode-binary helpers', () => {
  let root: string
  let originalBin: string | undefined
  const versionsByBinary = new Map<string, string>()
  const missingBinaries = new Set<string>()
  const probedCandidates: string[] = []

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ocm-binary-'))
    originalBin = process.env.OPENCODE_BIN
    versionsByBinary.clear()
    missingBinaries.clear()
    probedCandidates.length = 0
    childProcessMock.spawnSync.mockReset()
    childProcessMock.spawnSync.mockImplementation((binary: string) => {
      probedCandidates.push(binary)
      if (missingBinaries.has(binary)) return { status: null, stdout: '', stderr: '', error: new Error('spawnSync ENOENT') }
      const version = versionsByBinary.get(binary)
      if (!version) return { status: 1, stdout: '', stderr: '' }
      return { status: 0, stdout: `opencode v${version}\n`, stderr: '' }
    })
    childProcessMock.spawn.mockReset()
  })

  afterEach(async () => {
    if (originalBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = originalBin
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  describe('resolveOpenCode2Binary', () => {
    it('returns the 2.x OPENCODE_BIN without probing further candidates', () => {
      process.env.OPENCODE_BIN = path.join(root, 'opencode-2')
      versionsByBinary.set(process.env.OPENCODE_BIN, SUPPORTED_VERSION)

      expect(resolveOpenCode2Binary()).toBe(process.env.OPENCODE_BIN)
      expect(probedCandidates).toEqual([process.env.OPENCODE_BIN])
    })

    it('falls through a rejected 1.x OPENCODE_BIN to an available 2.x candidate', () => {
      process.env.OPENCODE_BIN = path.join(root, 'opencode-1')
      versionsByBinary.set(process.env.OPENCODE_BIN, '1.18.32')
      versionsByBinary.set('/usr/local/bin/opencode', SUPPORTED_VERSION)

      expect(resolveOpenCode2Binary()).toBe('/usr/local/bin/opencode')
      expect(probedCandidates).toEqual([process.env.OPENCODE_BIN, PATH_CANDIDATE, '/usr/local/bin/opencode'])
    })

    it('returns null when every candidate is missing or unsupported', () => {
      process.env.OPENCODE_BIN = path.join(root, 'missing')
      missingBinaries.add(process.env.OPENCODE_BIN)
      versionsByBinary.set('/opt/opencode/bin/opencode', '1.18.32')

      expect(resolveOpenCode2Binary()).toBeNull()
      expect(probedCandidates).toEqual([process.env.OPENCODE_BIN, PATH_CANDIDATE, ...ABSOLUTE_CANDIDATES])
    })
  })

  describe('startOpenCodeServe', () => {
    it('keeps the generated password authoritative over an OPENCODE_SERVER_PASSWORD passed in env', async () => {
      process.env.OPENCODE_BIN = OPENCODE_BIN_FIXTURE
      versionsByBinary.set(OPENCODE_BIN_FIXTURE, SUPPORTED_VERSION)
      const child = createFakeChild()
      childProcessMock.spawn.mockReturnValue(child)
      const requests: Array<{ url: string; authorization: string | undefined }> = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const authorization = new Headers(init?.headers).get('Authorization') ?? undefined
        requests.push({ url: String(input), authorization })
        return { ok: true } as Response
      })

      const callerHome = path.join(root, 'caller-home')
      const callerConfigHome = path.join(root, 'caller-config')
      const serve = await startOpenCodeServe({
        env: {
          HOME: callerHome,
          XDG_CONFIG_HOME: callerConfigHome,
          OPENCODE_SERVER_PASSWORD: 'caller-supplied-password',
        },
      })

      const spawnOptions = childProcessMock.spawn.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv }
      expect(spawnOptions.env.OPENCODE_SERVER_PASSWORD).toBe(serve.password)
      expect(serve.password.length).toBeGreaterThan(0)
      expect(serve.password).not.toBe('caller-supplied-password')
      expect(serve.homeDirectory).toBe(callerHome)
      expect(serve.configHome).toBe(callerConfigHome)
      expect(spawnOptions.env.HOME).toBe(callerHome)
      expect(spawnOptions.env.XDG_CONFIG_HOME).toBe(callerConfigHome)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe(`${serve.baseUrl}/api/info`)
      const authorization = requests[0]?.authorization ?? ''
      expect(authorization.startsWith('Basic ')).toBe(true)
      expect(Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8')).toBe(`${OPENCODE_SERVER_USERNAME}:${serve.password}`)

      await serve.stop()
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    })
  })
})
