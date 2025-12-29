import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { readFile } from 'fs/promises'
import { opencodeServerManager } from '../services/opencode-single-server'

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

  return app
}
