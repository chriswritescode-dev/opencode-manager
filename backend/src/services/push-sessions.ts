import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'node:crypto'

export type PushFileStatus = 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed'

export interface PushManifestEntry {
  path: string
  status: PushFileStatus
  mode?: string
  size?: number
  symlinkTarget?: string
  oldPath?: string
}

export interface PushSession {
  token: string
  repoId: number
  repoPath: string
  stagingDir: string
  manifest: PushManifestEntry[]
  expectedHead: string | null
  uploaded: Set<string>
  expiresAt: number
}

const sessions = new Map<string, PushSession>()
const TTL_MS = 10 * 60 * 1000
const STAGING_ROOT = join(tmpdir(), 'opencode-manager-push')

mkdirSync(STAGING_ROOT, { recursive: true })

function makeToken(): string {
  return randomBytes(24).toString('hex')
}

export interface BeginPushArgs {
  repoId: number
  repoPath: string
  manifest: PushManifestEntry[]
  expectedHead: string | null
}

export function beginPushSession(args: BeginPushArgs): PushSession {
  const token = makeToken()
  const stagingDir = join(STAGING_ROOT, token)
  mkdirSync(stagingDir, { recursive: true })
  const session: PushSession = {
    token,
    repoId: args.repoId,
    repoPath: args.repoPath,
    stagingDir,
    manifest: args.manifest,
    expectedHead: args.expectedHead,
    uploaded: new Set(),
    expiresAt: Date.now() + TTL_MS,
  }
  sessions.set(token, session)
  return session
}

export function getPushSession(token: string): PushSession | undefined {
  const s = sessions.get(token)
  if (!s) return undefined
  if (Date.now() > s.expiresAt) {
    destroyPushSession(token)
    return undefined
  }
  return s
}

export function touchPushSession(token: string): void {
  const s = sessions.get(token)
  if (s) s.expiresAt = Date.now() + TTL_MS
}

export function destroyPushSession(token: string): void {
  const s = sessions.get(token)
  if (!s) return
  sessions.delete(token)
  try {
    rmSync(s.stagingDir, { recursive: true, force: true })
  } catch {
    // staging may already be gone
  }
}

export function listPushSessions(): PushSession[] {
  return Array.from(sessions.values())
}

let sweepInterval: ReturnType<typeof setInterval> | null = null

export function startPushSessionSweep(intervalMs = 60_000): void {
  if (sweepInterval) return
  sweepInterval = setInterval(() => {
    const now = Date.now()
    for (const session of Array.from(sessions.values())) {
      if (now > session.expiresAt) {
        destroyPushSession(session.token)
      }
    }
  }, intervalMs)
  // don't block process exit
  if (typeof sweepInterval.unref === 'function') sweepInterval.unref()
}

export function stopPushSessionSweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval)
    sweepInterval = null
  }
}
