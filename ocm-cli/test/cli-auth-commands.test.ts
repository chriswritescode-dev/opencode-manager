import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { createFileTokenStore } from '../src/token-store-file.js'
import { createCliHome, type CliHome } from './helpers/cli-home.js'

const MANAGER = 'https://manager.example.com'

interface LoadOptions {
  state?: { managerUrl: string } | null
  token?: string | null
  envToken?: string | null
  documentVersion?: number
}

const homes: CliHome[] = []

async function loadCli(options: LoadOptions = {}) {
  const home = createCliHome({
    state: options.state === undefined ? { managerUrl: MANAGER } : options.state,
    token: options.token ?? null,
    envToken: options.envToken ?? null,
    documentVersion: options.documentVersion,
    account: MANAGER,
  })
  homes.push(home)
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
  vi.resetModules()
  const cli = await import('../bin/ocm')
  return {
    cli,
    written,
    stderr,
    home,
    storedToken: () => createFileTokenStore(home.credentialsPath).get(MANAGER),
    restore: () => {
      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
    },
  }
}

async function exitCodeOnFailure(run: () => Promise<void>): Promise<number | undefined> {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit')
  })
  await expect(run()).rejects.toThrow('exit')
  const code = z.number().safeParse(exitSpy.mock.calls[0]?.[0])
  exitSpy.mockRestore()
  return code.success ? code.data : undefined
}

describe('cli auth commands', () => {
  let originalArgv: string[]

  beforeEach(() => {
    originalArgv = process.argv.slice()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.argv = originalArgv
    for (const home of homes.splice(0)) home.restore()
  })

  it('ocm status reports the store kind and location', async () => {
    const { cli, written, home, restore } = await loadCli({ token: 'tok' })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('token store:')
    expect(out).toContain(`file (${home.credentialsPath})`)
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
    const { cli, written, restore } = await loadCli({ envToken: 'tok_env' })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('env (OCM_TOKEN)')
    restore()
  })

  it('ocm status reports the store in the no-state branch', async () => {
    const { cli, written, home, restore } = await loadCli({ state: null, token: null })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('token store:')
    expect(out).toContain(`file (${home.credentialsPath})`)
    expect(out).toMatch(/^token:\s+no/m)
    restore()
  })

  it('ocm status reports a token is present in the no-state branch when OCM_TOKEN is active', async () => {
    const { cli, written, restore } = await loadCli({ state: null, envToken: 'tok_env' })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toContain('token store:')
    expect(out).toContain('env (OCM_TOKEN)')
    expect(out).toMatch(/^token:\s+yes/m)
    restore()
  })

  it('ocm status reports an unavailable token store instead of exiting', async () => {
    const { cli, written, restore } = await loadCli({ documentVersion: 2 })
    await cli.cmdStatus()
    const out = written.join('')
    expect(out).toMatch(/^token:\s+unavailable \(token file .*unsupported format version 2/m)
    expect(out).toContain('manager url:')
    restore()
  })

  it('ocm login stores the token for the normalized manager url', async () => {
    const { cli, storedToken, restore } = await loadCli()
    await cli.cmdLogin(['https://manager.example.com/', 'tok_xyz'])
    expect(await storedToken()).toBe('tok_xyz')
    restore()
  })

  it('ocm login names the store on success', async () => {
    const { cli, written, home, restore } = await loadCli()
    await cli.cmdLogin(['https://manager.example.com', 'tok_xyz'])
    expect(written.join('')).toContain(`Saved token for ${MANAGER} (file: ${home.credentialsPath}).`)
    restore()
  })

  it('ocm login reports the persisted store and warns that OCM_TOKEN wins', async () => {
    const { cli, written, home, restore } = await loadCli({ envToken: 'tok_env' })
    await cli.cmdLogin(['https://manager.example.com', 'tok_xyz'])
    const out = written.join('')
    expect(out).toContain(`Saved token for ${MANAGER} (file: ${home.credentialsPath}).`)
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
    const { cli, stderr, restore } = await loadCli({ documentVersion: 2 })
    const code = await exitCodeOnFailure(() => cli.cmdLogin(['https://manager.example.com', 'tok_xyz']))
    expect(code).toBe(1)
    expect(stderr.join('')).toContain('token store error: token file ')
    expect(stderr.join('')).toContain('unsupported format version 2')
    restore()
  })

  async function expectLoginUsageError(args: string[]): Promise<void> {
    const { cli, stderr, storedToken, restore } = await loadCli()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    await expect(cli.cmdLogin(args)).rejects.toThrow('exit')
    expect(stderr.join('')).toContain('usage: ocm login <url> [token] [--name <name>]')
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(await storedToken()).toBeNull()
    restore()
  }

  it('ocm login rejects a repeated --name flag without saving a token', async () => {
    await expectLoginUsageError(['https://manager.example.com', '--name', 'prod', '--name', 'staging'])
  })

  it('ocm login rejects a --name flag without a value', async () => {
    await expectLoginUsageError(['https://manager.example.com', 'tok_xyz', '--name'])
  })

  it('ocm login rejects a --name value that looks like a flag', async () => {
    await expectLoginUsageError(['https://manager.example.com', '--name', '--force'])
  })

  it('ocm login rejects an unknown flag', async () => {
    await expectLoginUsageError(['https://manager.example.com', 'tok_xyz', '--force'])
  })

  it('ocm login accepts the token before or after --name', async () => {
    const afterName = await loadCli()
    await afterName.cli.cmdLogin(['https://manager.example.com', 'tok_xyz', '--name', 'prod'])
    expect(await afterName.storedToken()).toBe('tok_xyz')
    afterName.restore()

    const beforeName = await loadCli()
    await beforeName.cli.cmdLogin(['https://manager.example.com', '--name', 'prod', 'tok_xyz'])
    expect(await beforeName.storedToken()).toBe('tok_xyz')
    beforeName.restore()
  })

  it('ocm logout reports removal', async () => {
    const { cli, written, restore } = await loadCli({ token: 'tok' })
    await cli.cmdLogout()
    expect(written.join('')).toContain('Removed stored token for')
    restore()
  })

  it('ocm logout reports nothing stored', async () => {
    const { cli, written, restore } = await loadCli({ token: null })
    await cli.cmdLogout()
    expect(written.join('')).toContain('No stored token found.')
    restore()
  })

  it('ocm logout clears state even when the store delete fails', async () => {
    const { cli, written, stderr, home, restore } = await loadCli({ documentVersion: 2 })
    const code = await exitCodeOnFailure(() => cli.cmdLogout())
    expect(code).toBe(1)
    expect(written.join('')).toContain('State cleared.')
    expect(stderr.join('')).toContain('token store error: token file ')
    expect(stderr.join('')).toContain('unsupported format version 2')

    vi.resetModules()
    const { readState } = await import('../src/state.js')
    expect(readState()).toBeNull()
    expect(readFileSync(home.statePath, 'utf-8')).toBe('{}')
    restore()
  })

  it('ocm logout warns that OCM_TOKEN still authenticates', async () => {
    const { cli, written, restore } = await loadCli({ token: 'tok', envToken: 'tok_env' })
    await cli.cmdLogout()
    expect(written.join('')).toContain('note: OCM_TOKEN is set and takes precedence over the stored token')
    restore()
  })
})

describe('cli home fixture', () => {
  it('writes state and credentials under the temporary home', async () => {
    const home = createCliHome({ state: { managerUrl: MANAGER, lastRepoId: 7 }, token: 'tok' })
    homes.push(home)

    mkdirSync(dirname(home.statePath), { recursive: true })
    writeFileSync(home.credentialsPath, JSON.stringify({ version: 1, tokens: { [MANAGER]: 'tok_from_disk' } }))

    vi.resetModules()
    const { readState } = await import('../src/state.js')
    expect(readState()?.lastRepoId).toBe(7)
    expect(await createFileTokenStore(home.credentialsPath).get(MANAGER)).toBe('tok_from_disk')
  })
})
