import path from 'path'
import { promises as fs } from 'fs'
import { writeFileAtomic } from '../utils/fs-safe'

const OPENCODE_APP_DIRECTORY = 'opencode'
const OPENCODE_SERVICE_FILENAME = 'service.json'

export const OPENCODE_SERVICE_SERVE_ARGS = ['serve', '--service'] as const

export type OpenCodeServiceEnv = {
  XDG_CONFIG_HOME: string
  XDG_STATE_HOME: string
  OPENCODE_CONFIG_DIR?: string
}

function resolveOpenCodeGlobalConfigDirectory(env: OpenCodeServiceEnv): string {
  return env.OPENCODE_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME, OPENCODE_APP_DIRECTORY)
}

export function getOpenCodeServiceSettingsPath(env: OpenCodeServiceEnv): string {
  return path.join(resolveOpenCodeGlobalConfigDirectory(env), OPENCODE_SERVICE_FILENAME)
}

export function getOpenCodeServiceRegistrationPath(env: OpenCodeServiceEnv): string {
  return path.join(env.XDG_STATE_HOME, OPENCODE_APP_DIRECTORY, OPENCODE_SERVICE_FILENAME)
}

export async function prepareOpenCodeServiceLaunch(env: OpenCodeServiceEnv, password: string): Promise<void> {
  await fs.rm(getOpenCodeServiceRegistrationPath(env), { force: true })
  await writeFileAtomic(getOpenCodeServiceSettingsPath(env), `${JSON.stringify({ password }, null, 2)}\n`, { mode: 0o600 })
}
