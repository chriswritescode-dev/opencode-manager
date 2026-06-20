import { promises as fs } from 'fs'
import path from 'path'
import { logger } from '../utils/logger'

const PLUGIN_FILENAME = 'ocm-gh-env.js'

const PLUGIN_SOURCE = `const TTL_MS = 5000
let cache = { expiry: 0, env: {} }

async function fetchGhEnv() {
  const baseUrl = process.env.OCM_INTERNAL_API_URL
  const token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) return {}
  const now = Date.now()
  if (now < cache.expiry) return cache.env
  try {
    const res = await fetch(baseUrl + '/git-credentials/gh-env', {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!res.ok) return cache.env
    const env = await res.json()
    cache = { expiry: now + TTL_MS, env: env && typeof env === 'object' ? env : {} }
    return cache.env
  } catch {
    return cache.env
  }
}

export default async function () {
  return {
    'shell.env': async (_input, output) => {
      const env = await fetchGhEnv()
      Object.assign(output.env, env)
    },
  }
}
`

export function getGhEnvPluginDir(configHome: string): string {
  return path.join(configHome, 'opencode', 'plugin')
}

export async function installGhEnvPlugin(configHome: string): Promise<void> {
  try {
    const dir = getGhEnvPluginDir(configHome)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, PLUGIN_FILENAME), PLUGIN_SOURCE, 'utf-8')
  } catch (error) {
    logger.warn('Failed to install gh-env OpenCode plugin:', error)
  }
}
