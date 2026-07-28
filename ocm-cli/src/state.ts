import { existsSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { readJsonFile, writeJsonFileAtomic } from './json-store.js'

export interface OcmState {
  managerUrl: string
  lastRepoId?: number
  lastRepoName?: string
  lastRepoDir?: string
  lastRepoBranch?: string | null
  updatedAt?: number
}

export interface InstallNotice {
  link: string
  binDir: string
  pathMissing: boolean
}

const STATE_DIR = join(homedir(), '.config', 'opencode-manager')
const STATE_FILE = join(STATE_DIR, 'state.json')
const INSTALL_NOTICE_FILE = join(STATE_DIR, 'install-notice.json')

export function getConfigDir(): string {
  return STATE_DIR
}

export function getStatePath(): string {
  return STATE_FILE
}

export function readState(): OcmState | null {
  try {
    const parsed = readJsonFile<OcmState>(STATE_FILE)
    return parsed?.managerUrl ? parsed : null
  } catch {
    return null
  }
}

export function writeState(state: OcmState): void {
  writeJsonFileAtomic(STATE_FILE, { ...state, updatedAt: Date.now() })
}

export function clearState(): void {
  if (existsSync(STATE_FILE)) {
    writeJsonFileAtomic(STATE_FILE, {})
  }
}

export function readInstallNotice(): InstallNotice | null {
  try {
    const parsed = readJsonFile<InstallNotice>(INSTALL_NOTICE_FILE)
    return parsed?.link && parsed.binDir ? parsed : null
  } catch {
    return null
  } finally {
    deleteInstallNotice()
  }
}

function deleteInstallNotice(): void {
  try {
    unlinkSync(INSTALL_NOTICE_FILE)
  } catch {
    return
  }
}
