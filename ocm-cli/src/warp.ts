import { spawnSync } from 'node:child_process'
import { buildRemoteAttachEnv } from './remote-context.js'

export type WarpTarget = {
  managerUrl: string
  token: string
  directory: string
  sessionID: string
  repoName: string
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

export function buildAttachArgs(target: WarpTarget): string[] {
  return [
    'attach',
    `${target.managerUrl}/api/opencode-proxy`,
    '--dir', target.directory,
    '--session', target.sessionID,
    '--password', target.token,
    '--username', 'opencode',
  ]
}

export function runPendingWarp(spawn: WarpSpawn = spawnSync): void {
  const target = takePendingWarp()
  if (!target) return
  try {
    spawn('opencode', buildAttachArgs(target), {
      stdio: 'inherit',
      env: { ...process.env, ...buildRemoteAttachEnv(target.managerUrl, target.repoName) },
    })
  } catch {
    void 0
  }
}