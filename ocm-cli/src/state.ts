import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface OcmState {
  managerUrl: string
  lastRepoId?: number
  lastRepoName?: string
  lastRepoDir?: string
  lastRepoBranch?: string | null
  updatedAt?: number
}

const STATE_DIR = join(homedir(), '.config', 'opencode-manager')
const STATE_FILE = join(STATE_DIR, 'state.json')

export function getStatePath(): string {
  return STATE_FILE
}

export function readState(): OcmState | null {
  if (!existsSync(STATE_FILE)) return null
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as OcmState
    if (!parsed.managerUrl) return null
    return parsed
  } catch {
    return null
  }
}

export function writeState(state: OcmState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  const next: OcmState = { ...state, updatedAt: Date.now() }
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), { mode: 0o600 })
}

export function clearState(): void {
  if (existsSync(STATE_FILE)) {
    writeFileSync(STATE_FILE, '{}', { mode: 0o600 })
  }
}
