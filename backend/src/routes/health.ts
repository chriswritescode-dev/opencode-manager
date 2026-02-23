import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { readFile } from 'fs/promises'
import { opencodeServerManager } from '../services/opencode-single-server'
import { compareVersions } from '../utils/version-utils'

const GITHUB_REPO_OWNER = 'chriswritescode-dev'
const GITHUB_REPO_NAME = 'opencode-manager'

interface CachedRelease {
  tagName: string
  htmlUrl: string
  name: string
  fetchedAt: number
}

let cachedRelease: CachedRelease | null = null
const CACHE_TTL_MS = 60 * 60 * 1000

async function fetchLatestRelease(): Promise<CachedRelease | null> {
  if (cachedRelease && Date.now() - cachedRelease.fetchedAt < CACHE_TTL_MS) {
    return cachedRelease
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'OpenCode-Manager'
        }
      }
    )

    if (!response.ok) {
      return cachedRelease
    }

    const data = await response.json() as { tag_name?: string; html_url?: string; name?: string }
    const tagName = data.tag_name ?? '0.0.0'
    const htmlUrl = data.html_url ?? ''
    const name = data.name ?? tagName

    cachedRelease = {
      tagName,
      htmlUrl,
      name,
      fetchedAt: Date.now()
    }

    return cachedRelease
  } catch {
    return cachedRelease
  }
}

const opencodeManagerVersionPromise = (async (): Promise<string | null> => {
  try {
    const packageUrl = new URL('../../../package.json', import.meta.url)
    const packageJsonRaw = await readFile(packageUrl, 'utf-8')
    const packageJson = JSON.parse(packageJsonRaw) as { version?: unknown }
    return typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    return null
  }
})()

export function createHealthRoutes(db: Database) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const opencodeManagerVersion = await opencodeManagerVersionPromise
      const dbCheck = db.prepare('SELECT 1').get()
      const opencodeHealthy = await opencodeServerManager.checkHealth()
      const startupError = opencodeServerManager.getLastStartupError()

      const status = startupError && !opencodeHealthy
        ? 'unhealthy'
        : (dbCheck && opencodeHealthy ? 'healthy' : 'degraded')

      const response: Record<string, unknown> = {
        status,
        timestamp: new Date().toISOString(),
        database: dbCheck ? 'connected' : 'disconnected',
        opencode: opencodeHealthy ? 'healthy' : 'unhealthy',
        opencodePort: opencodeServerManager.getPort(),
        opencodeVersion: opencodeServerManager.getVersion(),
        opencodeMinVersion: opencodeServerManager.getMinVersion(),
        opencodeVersionSupported: opencodeServerManager.isVersionSupported(),
        opencodeManagerVersion,
      }

      if (startupError && !opencodeHealthy) {
        response.error = startupError
      }

      return c.json(response)
    } catch (error) {
      const opencodeManagerVersion = await opencodeManagerVersionPromise
      return c.json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        opencodeManagerVersion,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 503)
    }
  })

  app.get('/processes', async (c) => {
    try {
      const opencodeHealthy = await opencodeServerManager.checkHealth()
      
      return c.json({
        opencode: {
          port: opencodeServerManager.getPort(),
          healthy: opencodeHealthy
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }, 500)
    }
  })

  app.get('/version', async (c) => {
    const currentVersion = await opencodeManagerVersionPromise
    const latestRelease = await fetchLatestRelease()

    if (!currentVersion) {
      return c.json({
        currentVersion: null,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseName: null
      })
    }

    if (!latestRelease) {
      return c.json({
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseName: null
      })
    }

    const latestVersion = latestRelease.tagName.replace(/^v/, '')
    const isUpdateAvailable = compareVersions(currentVersion, latestVersion) < 0

    return c.json({
      currentVersion,
      latestVersion,
      updateAvailable: isUpdateAvailable,
      releaseUrl: latestRelease.htmlUrl,
      releaseName: latestRelease.name
    })
  })

  return app
}
