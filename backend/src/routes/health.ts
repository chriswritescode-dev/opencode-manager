import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { readFile } from 'fs/promises'
import { z } from 'zod'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import { compareSemver, normalizeSemver, parseSemver } from '@opencode-manager/shared/utils'
import { githubFetch } from '../utils/github'
import { logger } from '../utils/logger'
import { SandboxRuntimeService } from '../services/sandbox/runtime'
import { healthResponseSchema, type HealthResponse } from '@opencode-manager/shared/schemas'

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

const GitHubReleaseSchema = z.object({
  tag_name: z.string().optional(),
  html_url: z.string().optional(),
  name: z.string().optional(),
})

const PackageJsonSchema = z.object({
  version: z.string().optional(),
})

type OpenCodeHealthFields = Pick<
  HealthResponse,
  | 'opencodePort'
  | 'opencodeVersion'
  | 'opencodeMinVersion'
  | 'opencodeVersionSupported'
  | 'opencodeRestartPending'
>

function readOpenCodeHealthFields(openCodeStatus: HealthOpenCodeStatus): OpenCodeHealthFields {
  return {
    opencodePort: openCodeStatus.getPort(),
    opencodeVersion: openCodeStatus.getVersion(),
    opencodeMinVersion: openCodeStatus.getMinVersion(),
    opencodeVersionSupported: openCodeStatus.isVersionSupported(),
    opencodeRestartPending: openCodeStatus.isRestartPending(),
  }
}

async function fetchLatestRelease(): Promise<CachedRelease | null> {
  if (cachedRelease && Date.now() - cachedRelease.fetchedAt < CACHE_TTL_MS) {
    return cachedRelease
  }

  try {
    const response = await githubFetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
    )

    if (!response.ok) {
      return cachedRelease
    }

    const parsedRelease = GitHubReleaseSchema.safeParse(await response.json())
    const data = parsedRelease.success ? parsedRelease.data : {}
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
    const parsedPackageJson = PackageJsonSchema.safeParse(JSON.parse(packageJsonRaw))
    return parsedPackageJson.success ? parsedPackageJson.data.version ?? null : null
  } catch {
    return null
  }
})()

export type HealthSupervisor = Pick<OpenCodeSupervisor, 'getStatus' | 'checkNow'>

export type HealthOpenCodeStatus = Pick<
  typeof opencodeServerManager,
  | 'checkHealth'
  | 'getLastStartupError'
  | 'getPort'
  | 'getVersion'
  | 'getMinVersion'
  | 'isVersionSupported'
  | 'isRestartPending'
  | 'isSandboxEnforced'
>

export interface HealthProbes {
  pingDatabase: () => boolean
}

export function createHealthRoutes(
  db: Database,
  openCodeSupervisor?: HealthSupervisor,
  openCodeStatus: HealthOpenCodeStatus = opencodeServerManager,
  probes: HealthProbes = { pingDatabase: () => Boolean(db.prepare('SELECT 1').get()) },
) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const opencodeManagerVersion = await opencodeManagerVersionPromise
      const databaseReachable = probes.pingDatabase()
      const lifecycle = openCodeSupervisor
        ? openCodeSupervisor.getStatus()
        : null
      const opencodeHealthy = await openCodeStatus.checkHealth()
      const startupError = lifecycle?.lastError ?? openCodeStatus.getLastStartupError()

      const status = lifecycle?.state === 'recovering'
        ? 'degraded'
        : startupError && !opencodeHealthy
        ? 'unhealthy'
        : (databaseReachable && opencodeHealthy ? 'healthy' : 'degraded')

      const response: HealthResponse = {
        status,
        timestamp: new Date().toISOString(),
        database: databaseReachable ? 'connected' : 'disconnected',
        opencode: opencodeHealthy ? 'healthy' : 'unhealthy',
        ...readOpenCodeHealthFields(openCodeStatus),
        opencodeManagerVersion,
      }

      try {
        const runtimeStatus = new SandboxRuntimeService(db).getStatus()
        response.sandbox = {
          ...runtimeStatus,
          enforced: openCodeStatus.isSandboxEnforced(),
        }
      } catch (error) {
        logger.error('Failed to collect sandbox status', error)
        response.sandbox = {
          available: false,
          enabled: false,
          enforced: openCodeStatus.isSandboxEnforced(),
          reason: error instanceof Error ? error.message : 'sandbox status unavailable',
        }
      }

      if (lifecycle) {
        response.opencodeLifecycle = lifecycle
      }

      if (startupError && !opencodeHealthy) {
        response.error = startupError
      }

      return c.json(healthResponseSchema.parse(response), status === 'unhealthy' ? 503 : 200)
    } catch (error) {
      const opencodeManagerVersion = await opencodeManagerVersionPromise
      const response: HealthResponse = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        opencode: 'unhealthy',
        ...readOpenCodeHealthFields(openCodeStatus),
        opencodeManagerVersion,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
      return c.json(healthResponseSchema.parse(response), 503)
    }
  })

  app.get('/processes', async (c) => {
    try {
      const lifecycle = openCodeSupervisor
        ? openCodeSupervisor.getStatus()
        : null
      const opencodeHealthy = await openCodeStatus.checkHealth()
       
      return c.json({
        opencode: {
          port: openCodeStatus.getPort(),
          healthy: opencodeHealthy,
          lifecycle,
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

    const latestVersion = normalizeSemver(latestRelease.tagName)
    const isUpdateAvailable = parseSemver(currentVersion) !== null
      && parseSemver(latestVersion) !== null
      && compareSemver(currentVersion, latestVersion) < 0

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
