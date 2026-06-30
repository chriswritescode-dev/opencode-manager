import { Hono } from 'hono'
import { z } from 'zod'
import { ManagerUpgradeService, ManagerUpgradeError } from '../services/manager-upgrade'
import { handleServiceError } from '../utils/route-helpers'

export function createManagerUpgradeRoutes(service: ManagerUpgradeService) {
  const app = new Hono()

  app.get('/status', async (c) => {
    try {
      const status = await service.getStatus()
      return c.json(status)
    } catch (error) {
      return handleServiceError(c, error, 'Failed to get manager upgrade status', ManagerUpgradeError)
    }
  })

  app.post('/', async (c) => {
    try {
      const bodyText = await c.req.text()
      const raw = bodyText.trim() === '' ? {} : JSON.parse(bodyText)
      const { version } = z.object({ version: z.string().min(1).optional() }).parse(raw)
      const job = await service.startUpgrade(version)
      return c.json({ job }, 202)
    } catch (error) {
      return handleServiceError(c, error, 'Manager upgrade failed', ManagerUpgradeError)
    }
  })

  return app
}
