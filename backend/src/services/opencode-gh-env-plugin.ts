import { promises as fs } from 'fs'
import path from 'path'
import { logger } from '../utils/logger'

const PLUGIN_FILENAME = 'ocm-gh-env.js'

const PLUGIN_SOURCE = `const TTL_MS = 5000
let cache = new Map()

async function fetchGhEnv(cwd) {
  const baseUrl = process.env.OCM_INTERNAL_API_URL
  const token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) return {}
  const now = Date.now()
  const cacheKey = cwd || ''
  const cached = cache.get(cacheKey)
  if (cached && now < cached.expiry) return cached.env
  try {
    const url = new URL(baseUrl + '/git-credentials/gh-env')
    if (cwd) url.searchParams.set('cwd', cwd)
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!res.ok) return cached?.env || {}
    const env = await res.json()
    const next = { expiry: now + TTL_MS, env: env && typeof env === 'object' ? env : {} }
    cache.set(cacheKey, next)
    return next.env
  } catch {
    return cached?.env || {}
  }
}

export default async function () {
  return {
    'shell.env': async (input, output) => {
      const env = await fetchGhEnv(input.cwd)
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
