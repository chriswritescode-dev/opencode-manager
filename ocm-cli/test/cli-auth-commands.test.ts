import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type StoreOverride = { kind: string; location: string }
type CliOverrides = {
  token?: string | null
  store?: StoreOverride
  backendStore?: StoreOverride
  setTokenImpl?: (url: string, token: string) => void
  deleteTokenImpl?: () => boolean
}

async function loadCli(overrides: CliOverrides = {}) {
  vi.resetModules()
  const setToken = vi.fn(overrides.setTokenImpl ?? (() => {}))
  const deleteToken = vi.fn(overrides.deleteTokenImpl ?? (() => true))
  vi.doMock('../src/state.js', () => ({
    readState: () => ({ managerUrl: 'https://manager.example.com' }),
    writeState: () => {},
    clearState: () => {},
    getStatePath: () => '/tmp/state.json',
    getConfigDir: () => '/tmp',
  }))
  vi.doMock('../src/credentials.js', () => ({
    getToken: () => overrides.token ?? null,
    setToken,
    deleteToken,
    describeCredentialStore: () => overrides.store ?? { kind: 'file', location: '/tmp/credentials.json' },
    describeBackendStore: () => overrides.backendStore ?? overrides.store ?? { kind: 'file', location: '/tmp/credentials.json' },
    CredentialStoreError: class extends Error {},
  }))
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
    setToken,
    deleteToken,
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
    vi.doUnmock('../src/state.js')
    vi.doUnmock('../src/credentials.js')
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
    const { cli, written, restore } = await loadCli({ store: { kind: 'env', location: 'OCM_TOKEN' } })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('env (OCM_TOKEN)')
    restore()
  })

  it('ocm status reports the store in the no-state branch', async () => {
    vi.resetModules()
    vi.doMock('../src/state.js', () => ({
      readState: () => null,
      writeState: () => {},
      clearState: () => {},
      getStatePath: () => '/tmp/state.json',
      getConfigDir: () => '/tmp',
    }))
    vi.doMock('../src/credentials.js', () => ({
      getToken: () => null,
      setToken: () => {},
      deleteToken: () => true,
      describeCredentialStore: () => ({ kind: 'file', location: '/tmp/credentials.json' }),
      CredentialStoreError: class extends Error {},
    }))
    const written: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { written.push(String(chunk)); return true })
    const cli = await import('../bin/ocm')
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('token store:')
    expect(out).toContain('file (/tmp/credentials.json)')
    expect(out).toMatch(/^token:\s+no/m)
    spy.mockRestore()
    vi.doUnmock('../src/state.js')
    vi.doUnmock('../src/credentials.js')
  })

  it('ocm status reports a token is present in the no-state branch when OCM_TOKEN is active', async () => {
    vi.resetModules()
    vi.doMock('../src/state.js', () => ({
      readState: () => null,
      writeState: () => {},
      clearState: () => {},
      getStatePath: () => '/tmp/state.json',
      getConfigDir: () => '/tmp',
    }))
    vi.doMock('../src/credentials.js', () => ({
      getToken: () => 'tok_env',
      setToken: () => {},
      deleteToken: () => true,
      describeCredentialStore: () => ({ kind: 'env', location: 'OCM_TOKEN' }),
      CredentialStoreError: class extends Error {},
    }))
    const written: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { written.push(String(chunk)); return true })
    const cli = await import('../bin/ocm')
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('token store:')
    expect(out).toContain('env (OCM_TOKEN)')
    expect(out).toMatch(/^token:\s+yes/m)
    spy.mockRestore()
    vi.doUnmock('../src/state.js')
    vi.doUnmock('../src/credentials.js')
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

  it('ocm login reports the persisted backend even when OCM_TOKEN is set', async () => {
    const { cli, written, restore } = await loadCli({
      store: { kind: 'env', location: 'OCM_TOKEN' },
      backendStore: { kind: 'file', location: '/tmp/credentials.json' },
    })
    await cli.cmdLogin(['https://manager.example.com', 'tok_xyz'])
    const out = written.join('')
    expect(out).toContain('Saved token for https://manager.example.com (file: /tmp/credentials.json).')
    expect(out).not.toContain('env (OCM_TOKEN)')
    expect(out).not.toContain('env: OCM_TOKEN')
    restore()
  })

  it('ocm login surfaces a store failure', async () => {
    class TestCredentialStoreError extends Error {}
    vi.resetModules()
    vi.doMock('../src/state.js', () => ({
      readState: () => ({ managerUrl: 'https://manager.example.com' }),
      writeState: () => {},
      clearState: () => {},
      getStatePath: () => '/tmp/state.json',
      getConfigDir: () => '/tmp',
    }))
    const setToken = vi.fn(() => { throw new TestCredentialStoreError('disk full') })
    vi.doMock('../src/credentials.js', () => ({
      getToken: () => null,
      setToken,
      deleteToken: () => true,
      describeCredentialStore: () => ({ kind: 'file', location: '/tmp/credentials.json' }),
      CredentialStoreError: TestCredentialStoreError,
    }))
    const storeErr: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { storeErr.push(String(chunk)); return true })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    const cli = await import('../bin/ocm')
    await expect(cli.cmdLogin(['https://manager.example.com', 'tok_xyz'])).rejects.toThrow('exit')
    expect(storeErr.join('')).toContain('credential store error: disk full')
    expect(exitSpy).toHaveBeenCalledWith(1)
    vi.doUnmock('../src/state.js')
    vi.doUnmock('../src/credentials.js')
  })

  it('ocm logout reports removal', async () => {
    const { cli, written, restore } = await loadCli({ deleteTokenImpl: () => true })
    await cli.cmdLogout()
    expect(written.join('')).toContain('Removed stored token for')
    restore()
  })

  it('ocm logout reports nothing stored', async () => {
    const { cli, written, restore } = await loadCli({ deleteTokenImpl: () => false })
    await cli.cmdLogout()
    expect(written.join('')).toContain('No stored token found.')
    restore()
  })
})
