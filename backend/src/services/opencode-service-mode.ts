import path from 'path'
import { promises as fs } from 'fs'
import { getConfigPath } from '@opencode-manager/shared/config/env'
import { writeFileAtomic } from '../utils/fs-safe'

const OPENCODE_APP_DIRECTORY = 'opencode'
const OPENCODE_SERVICE_FILENAME = 'service.json'

export const OPENCODE_SERVICE_SERVE_ARGS = ['serve', '--service'] as const

export type OpenCodeServiceEnv = {
  XDG_CONFIG_HOME: string
  XDG_STATE_HOME: string
}

export function getOpenCodeServiceSettingsPath(): string {
  return path.join(getConfigPath(), OPENCODE_SERVICE_FILENAME)
}

export function getOpenCodeServiceRegistrationPath(env: OpenCodeServiceEnv): string {
  return path.join(env.XDG_STATE_HOME, OPENCODE_APP_DIRECTORY, OPENCODE_SERVICE_FILENAME)
}

export async function writeOpenCodeServiceSettings(configDirectory: string, password: string): Promise<void> {
  await writeFileAtomic(path.join(configDirectory, OPENCODE_SERVICE_FILENAME), `${JSON.stringify({ password }, null, 2)}\n`, { mode: 0o600 })
}

export async function prepareOpenCodeServiceLaunch(env: OpenCodeServiceEnv, password: string): Promise<void> {
  await fs.rm(getOpenCodeServiceRegistrationPath(env), { force: true })
  await writeOpenCodeServiceSettings(getConfigPath(), password)
}
