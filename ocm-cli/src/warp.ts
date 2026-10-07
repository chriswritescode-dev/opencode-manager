import { spawnSync } from 'node:child_process'
import { buildRemoteAttachEnv, REMOTE_MANAGER_URL_ENV, REMOTE_REPO_ID_ENV, REMOTE_REPO_NAME_ENV } from './remote-context.js'
import { repoProxyUrl } from './repo-proxy.js'

export type AttachTarget = {
  managerUrl: string
  token: string
  repoId: number
  repoName: string
  sessionID?: string
}

export type PendingWarp = { kind: 'attach'; target: AttachTarget } | { kind: 'local' }

export type AttachInvocation = {
  args: string[]
  env: NodeJS.ProcessEnv
}

export type WarpSpawn = (
  command: string,
  args: string[],
  options: { stdio: 'inherit'; env: NodeJS.ProcessEnv },
) => unknown

const ATTACH_ENV_KEYS = ['OPENCODE_PASSWORD', REMOTE_MANAGER_URL_ENV, REMOTE_REPO_NAME_ENV, REMOTE_REPO_ID_ENV]

let pending: PendingWarp | undefined

export function setPendingWarp(warp: PendingWarp): void {
  pending = warp
}

export function takePendingWarp(): PendingWarp | undefined {
  const warp = pending
  pending = undefined
  return warp
}

export function buildAttachInvocation(target: AttachTarget): AttachInvocation {
  const args = ['--server', repoProxyUrl(target.managerUrl, target.repoId)]
  if (target.sessionID) args.push('--session', target.sessionID)
  return {
    args,
    env: { ...process.env, OPENCODE_PASSWORD: target.token, ...buildRemoteAttachEnv(target.managerUrl, target.repoName, target.repoId) },
  }
}

/** Builds a plain local `opencode` launch with every Manager attach variable removed. */
export function buildLocalInvocation(env: NodeJS.ProcessEnv = process.env): AttachInvocation {
  return {
    args: [],
    env: Object.fromEntries(Object.entries(env).filter(([key]) => !ATTACH_ENV_KEYS.includes(key))),
  }
}

export function runPendingWarp(spawn: WarpSpawn = spawnSync): void {
  const warp = takePendingWarp()
  if (!warp) return
  try {
    const { args, env } = warp.kind === 'attach' ? buildAttachInvocation(warp.target) : buildLocalInvocation()
    spawn('opencode', args, { stdio: 'inherit', env })
  } catch {
    void 0
  }
}
