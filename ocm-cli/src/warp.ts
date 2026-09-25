import { spawnSync } from 'node:child_process'
import { buildRemoteAttachEnv } from './remote-context.js'
import { repoProxyUrl } from './repo-proxy.js'

export type AttachTarget = {
  managerUrl: string
  token: string
  repoId: number
  repoName: string
  sessionID?: string
}

export type WarpTarget = AttachTarget & {
  sessionID: string
}

export type AttachInvocation = {
  args: string[]
  env: NodeJS.ProcessEnv
}

export type WarpSpawn = (
  command: string,
  args: string[],
  options: { stdio: 'inherit'; env: NodeJS.ProcessEnv },
) => unknown

let pending: WarpTarget | undefined

export function setPendingWarp(target: WarpTarget): void {
  pending = target
}

export function takePendingWarp(): WarpTarget | undefined {
  const t = pending
  pending = undefined
  return t
}

export function buildAttachInvocation(target: AttachTarget): AttachInvocation {
  const args = ['--server', repoProxyUrl(target.managerUrl, target.repoId)]
  if (target.sessionID) args.push('--session', target.sessionID)
  return {
    args,
    env: { ...process.env, OPENCODE_PASSWORD: target.token, ...buildRemoteAttachEnv(target.managerUrl, target.repoName) },
  }
}

export function runPendingWarp(spawn: WarpSpawn = spawnSync): void {
  const target = takePendingWarp()
  if (!target) return
  try {
    const { args, env } = buildAttachInvocation(target)
    spawn('opencode', args, { stdio: 'inherit', env })
  } catch {
    void 0
  }
}
