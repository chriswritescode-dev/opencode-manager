import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let home: string
let configDir: string
let savedHome: string | undefined

async function loadState() {
  vi.resetModules()
  return import('../src/state.js')
}

beforeEach(() => {
  savedHome = process.env.HOME
  home = mkdtempSync(join(tmpdir(), 'ocm-home-'))
  process.env.HOME = home
  configDir = join(home, '.config', 'opencode-manager')
})

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  rmSync(home, { recursive: true, force: true })
})

describe('cli state file', () => {
  it('returns null when no state file exists', async () => {
    const { readState } = await loadState()

    expect(readState()).toBeNull()
  })

  it('round-trips the manager url and last repo', async () => {
    const { readState, writeState } = await loadState()

    writeState({ managerUrl: 'https://manager.example.com', lastRepoId: 7, lastRepoName: 'repo' })

    const state = readState()
    expect(state?.managerUrl).toBe('https://manager.example.com')
    expect(state?.lastRepoId).toBe(7)
    expect(state?.updatedAt).toBeTypeOf('number')
  })

  it('writes the state file with owner-only permissions', async () => {
    if (process.platform === 'win32') return
    const { writeState, getStatePath } = await loadState()

    writeState({ managerUrl: 'https://manager.example.com' })

    expect(statSync(getStatePath()).mode & 0o777).toBe(0o600)
    expect(statSync(configDir).mode & 0o777).toBe(0o700)
  })

  it('repairs loose permissions on an existing state file', async () => {
    if (process.platform === 'win32') return
    const { writeState, getStatePath } = await loadState()
    mkdirSync(configDir, { recursive: true })
    writeFileSync(getStatePath(), '{}', { mode: 0o644 })

    writeState({ managerUrl: 'https://manager.example.com' })

    expect(statSync(getStatePath()).mode & 0o777).toBe(0o600)
  })

  it('leaves no temp file behind', async () => {
    const { writeState } = await loadState()

    writeState({ managerUrl: 'https://manager.example.com' })

    expect(readdirSync(configDir).filter((entry) => entry.endsWith('.tmp'))).toEqual([])
  })

  it('treats a corrupt state file as absent', async () => {
    const { readState, getStatePath } = await loadState()
    mkdirSync(configDir, { recursive: true })
    writeFileSync(getStatePath(), 'not json')

    expect(readState()).toBeNull()
  })

  it('treats a state file without a manager url as absent', async () => {
    const { readState, getStatePath } = await loadState()
    mkdirSync(configDir, { recursive: true })
    writeFileSync(getStatePath(), JSON.stringify({ lastRepoId: 1 }))

    expect(readState()).toBeNull()
  })

  it('clearState empties an existing state file without recreating a missing one', async () => {
    const { readState, writeState, clearState, getStatePath } = await loadState()

    clearState()
    expect(existsSync(getStatePath())).toBe(false)

    writeState({ managerUrl: 'https://manager.example.com' })
    clearState()

    expect(readState()).toBeNull()
    expect(readFileSync(getStatePath(), 'utf-8')).toBe('{}')
  })

  it('reads an install notice once and then removes it', async () => {
    const { readInstallNotice } = await loadState()
    mkdirSync(configDir, { recursive: true })
    const noticeFile = join(configDir, 'install-notice.json')
    writeFileSync(noticeFile, JSON.stringify({ link: '~/.local/bin/ocm', binDir: '~/.local/bin', pathMissing: true }))

    expect(readInstallNotice()).toEqual({ link: '~/.local/bin/ocm', binDir: '~/.local/bin', pathMissing: true })
    expect(existsSync(noticeFile)).toBe(false)
    expect(readInstallNotice()).toBeNull()
  })

  it('ignores an incomplete install notice', async () => {
    const { readInstallNotice } = await loadState()
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'install-notice.json'), JSON.stringify({ binDir: '~/.local/bin' }))

    expect(readInstallNotice()).toBeNull()
  })
})
