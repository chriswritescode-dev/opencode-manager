import { Hono } from 'hono'
import { AssistantSettingsPatchSchema } from '@opencode-manager/shared/schemas'
import type { SettingsService } from '../../services/settings'
import type { UserPreferences } from '@opencode-manager/shared/types'

export function createInternalSettingsRoutes(settingsService: SettingsService) {
  const app = new Hono()

  app.get('/', (c) => {
    const userId = c.req.query('userId') ?? 'default'
    const settings = settingsService.getSettings(userId)
    return c.json(settings)
  })

  app.patch('/', async (c) => {
    const userId = c.req.query('userId') ?? 'default'

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = AssistantSettingsPatchSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }

    const updated = settingsService.updateSettings(parsed.data as Partial<UserPreferences>, userId)
    return c.json(updated)
  })

  return app
}
