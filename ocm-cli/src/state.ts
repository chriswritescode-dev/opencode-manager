import { existsSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { z } from 'zod'
import { readJsonFile, writeJsonFileAtomic } from './json-store.js'

const OcmStateSchema = z.object({
  managerUrl: z.string(),
  managerName: z.string().optional(),
  lastRepoId: z.number().optional(),
  lastRepoName: z.string().optional(),
  lastRepoDir: z.string().optional(),
  lastRepoBranch: z.string().nullish(),
  updatedAt: z.number().optional(),
})

const InstallNoticeSchema = z.object({
  link: z.string(),
  binDir: z.string(),
  pathMissing: z.boolean(),
})

export type OcmState = z.infer<typeof OcmStateSchema>

export type InstallNotice = z.infer<typeof InstallNoticeSchema>

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
  const parsed = readJsonFile(STATE_FILE, OcmStateSchema)
  return parsed?.managerUrl ? parsed : null
}

export function writeState(state: OcmState): void {
  writeJsonFileAtomic(STATE_FILE, { ...state, updatedAt: Date.now() })
}

export function clearState(): void {
  if (existsSync(STATE_FILE)) {
    writeJsonFileAtomic(STATE_FILE, {})
  }
}

export function writeInstallNotice(notice: InstallNotice): void {
  try {
    writeJsonFileAtomic(INSTALL_NOTICE_FILE, notice)
  } catch {
    return
  }
}

export function readInstallNotice(): InstallNotice | null {
  let parsed: InstallNotice | null
  try {
    parsed = readJsonFile(INSTALL_NOTICE_FILE, InstallNoticeSchema)
  } catch {
    return null
  }
  deleteInstallNotice()
  return parsed?.link && parsed.binDir ? parsed : null
}

function deleteInstallNotice(): void {
  try {
    unlinkSync(INSTALL_NOTICE_FILE)
  } catch {
    return
  }
}
