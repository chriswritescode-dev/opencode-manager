import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OcmState } from '../../src/state.js'

export interface CliHomeOptions {
  state?: OcmState | null
  account?: string
  token?: string | null
  documentVersion?: number
  envToken?: string | null
}

export interface CliHome {
  home: string
  configDir: string
  statePath: string
  credentialsPath: string
  account: string
  writeState: (state: OcmState | null) => void
  writeToken: (token: string | null) => void
  restore: () => void
}

const DEFAULT_ACCOUNT = 'https://manager.example.com'

export function createCliHome(options: CliHomeOptions = {}): CliHome {
  const savedHome = process.env.HOME
  const savedToken = process.env.OCM_TOKEN
  const home = mkdtempSync(join(tmpdir(), 'ocm-home-'))
  process.env.HOME = home
  if (options.envToken) process.env.OCM_TOKEN = options.envToken
  else delete process.env.OCM_TOKEN

  const configDir = join(home, '.config', 'opencode-manager')
  mkdirSync(configDir, { recursive: true })
  const statePath = join(configDir, 'state.json')
  const credentialsPath = join(configDir, 'credentials.json')
  const account = options.account ?? DEFAULT_ACCOUNT

  function writeState(state: OcmState | null): void {
    writeFileSync(statePath, state === null ? '{}' : JSON.stringify(state))
  }

  function writeToken(token: string | null): void {
    const document = { version: options.documentVersion ?? 1, tokens: token === null ? {} : { [account]: token } }
    writeFileSync(credentialsPath, JSON.stringify(document))
  }

  writeState(options.state === undefined ? { managerUrl: account } : options.state)
  writeToken(options.token ?? null)

  return {
    home,
    configDir,
    statePath,
    credentialsPath,
    account,
    writeState,
    writeToken,
    restore: () => {
      if (savedHome === undefined) delete process.env.HOME
      else process.env.HOME = savedHome
      if (savedToken === undefined) delete process.env.OCM_TOKEN
      else process.env.OCM_TOKEN = savedToken
      rmSync(home, { recursive: true, force: true })
    },
  }
}
