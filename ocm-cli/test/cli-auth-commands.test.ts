import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { OcmState } from '../src/state.js'
import {
  MockTokenStoreError,
  mockStateModule,
  mockTokenStoreModule,
  unmockTokenStoreModules,
  type TokenStoreMockOptions,
} from './helpers/token-store-mocks.js'

type CliOverrides = TokenStoreMockOptions & {
  state?: OcmState | null
}

async function loadCli(overrides: CliOverrides = {}) {
  vi.resetModules()
  const state = 'state' in overrides ? overrides.state : { managerUrl: 'https://manager.example.com' }
  const { clearState } = mockStateModule(state ?? null)
  const { getToken, setToken, deleteToken } = mockTokenStoreModule(overrides)
  const written: string[] = []
  const stderr: string[] = []
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written.push(String(chunk))
    return true
  })
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  const cli = await import('../bin/ocm')
  return {
    cli,
    written,
    stderr,
    getToken,
    setToken,
    deleteToken,
    clearState,
    restore: () => {
      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
    },
  }
}

describe('cli auth commands', () => {
  let originalArgv: string[]

  beforeEach(() => {
    originalArgv = process.argv.slice()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.argv = originalArgv
    unmockTokenStoreModules()
  })

  it('ocm status reports the store kind and location', async () => {
    const { cli, written, restore } = await loadCli({ token: 'tok', store: { kind: 'file', location: '/tmp/credentials.json' } })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('token store:')
    expect(out).toContain('file (/tmp/credentials.json)')
    restore()
  })

  it('ocm status reports token presence', async () => {
    const present = await loadCli({ token: 'tok' })
    await present.cli.cmdStatus()
    expect(present.written.join('')).toMatch(/^token:\s+yes/m)
    present.restore()

    const absent = await loadCli({ token: null })
    await absent.cli.cmdStatus()
    expect(absent.written.join('')).toMatch(/^token:\s+no/m)
    absent.restore()
  })

  it('ocm status reports the env store', async () => {
    const { cli, written, restore } = await loadCli({ env: 'tok_env' })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('env (OCM_TOKEN)')
    restore()
  })

  it('ocm status reports the store in the no-state branch', async () => {
    const { cli, written, restore } = await loadCli({ state: null, token: null })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('token store:')
    expect(out).toContain('file (/tmp/credentials.json)')
    expect(out).toMatch(/^token:\s+no/m)
    restore()
  })

  it('ocm status reports a token is present in the no-state branch when OCM_TOKEN is active', async () => {
    const { cli, written, restore } = await loadCli({ state: null, env: 'tok_env' })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('token store:')
    expect(out).toContain('env (OCM_TOKEN)')
    expect(out).toMatch(/^token:\s+yes/m)
    restore()
  })

  it('ocm status reports an unavailable token store instead of exiting', async () => {
    const { cli, written, restore } = await loadCli({
      getTokenImpl: () => Promise.reject(new MockTokenStoreError('keychain locked', 'keychain')),
    })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toMatch(/^token:\s+unavailable \(keychain locked\)/m)
    expect(out).toContain('manager url:')
    restore()
  })

  it('ocm login stores the token verbatim', async () => {
    const { cli, setToken, restore } = await loadCli()
    await cli.cmdLogin(['https://manager.example.com/', 'tok_xyz'])
    expect(setToken).toHaveBeenCalledWith('https://manager.example.com', 'tok_xyz')
    restore()
  })

  it('ocm login names the store on success', async () => {
    const { cli, written, restore } = await loadCli({ store: { kind: 'file', location: '/tmp/credentials.json' } })
    await cli.cmdLogin(['https://manager.example.com', 'tok_xyz'])
    expect(written.join('')).toContain('Saved token for https://manager.example.com (file: /tmp/credentials.json).')
    restore()
  })

  it('ocm login reports the persisted store and warns that OCM_TOKEN wins', async () => {
    const { cli, written, restore } = await loadCli({
      env: 'tok_env',
      writeTarget: { kind: 'file', location: '/tmp/credentials.json' },
    })
    await cli.cmdLogin(['https://manager.example.com', 'tok_xyz'])
    const out = written.join('')
    expect(out).toContain('Saved token for https://manager.example.com (file: /tmp/credentials.json).')
    expect(out).toContain('note: OCM_TOKEN is set and takes precedence over the stored token')
    restore()
  })

  it('ocm login does not mention OCM_TOKEN when it is unset', async () => {
    const { cli, written, restore } = await loadCli()
    await cli.cmdLogin(['https://manager.example.com', 'tok_xyz'])
    expect(written.join('')).not.toContain('OCM_TOKEN')
    restore()
  })

  it('ocm login surfaces a store failure', async () => {
    const { cli, stderr, restore } = await loadCli({
      setTokenImpl: () => Promise.reject(new MockTokenStoreError('disk full')),
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(cli.cmdLogin(['https://manager.example.com', 'tok_xyz'])).rejects.toThrow('exit')
    expect(stderr.join('')).toContain('token store error: disk full')
    expect(exitSpy).toHaveBeenCalledWith(1)
    restore()
  })

  it('ocm logout reports removal', async () => {
    const { cli, written, restore } = await loadCli({ deleteTokenImpl: () => Promise.resolve(true) })
    await cli.cmdLogout()
    expect(written.join('')).toContain('Removed stored token for')
    restore()
  })

  it('ocm logout reports nothing stored', async () => {
    const { cli, written, restore } = await loadCli({ deleteTokenImpl: () => Promise.resolve(false) })
    await cli.cmdLogout()
    expect(written.join('')).toContain('No stored token found.')
    restore()
  })

  it('ocm logout clears state even when the store delete fails', async () => {
    const { cli, written, stderr, clearState, restore } = await loadCli({
      deleteTokenImpl: () => Promise.reject(new MockTokenStoreError('keychain locked', 'keychain')),
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(cli.cmdLogout()).rejects.toThrow('exit')
    expect(clearState).toHaveBeenCalledOnce()
    expect(written.join('')).toContain('State cleared.')
    expect(stderr.join('')).toContain('token store error: keychain locked')
    expect(exitSpy).toHaveBeenCalledWith(1)
    restore()
  })

  it('ocm logout warns that OCM_TOKEN still authenticates', async () => {
    const { cli, written, restore } = await loadCli({ env: 'tok_env' })
    await cli.cmdLogout()
    expect(written.join('')).toContain('note: OCM_TOKEN is set and takes precedence over the stored token')
    restore()
  })
})
