import { Hono } from 'hono'
import { AssistantSettingsPatchSchema } from '@opencode-manager/shared/schemas'
import type { SettingsService } from '../../services/settings'
import type { SettingsResponse, UserPreferences } from '@opencode-manager/shared/types'
import { OPENCODE_CONFIG_REDACTED_VALUE } from '../../services/opencode-config-file'

function redactSecret<T extends string | undefined>(value: T): T {
  return (value ? OPENCODE_CONFIG_REDACTED_VALUE : value) as T
}

/**
 * Replaces stored credentials in a settings response with `<redacted>` so token clients such as the
 * agent-facing `ocm` tool can read preferences without receiving secrets. Empty values stay empty, so a
 * caller can still tell whether a credential is configured.
 */
function redactInternalSettings(settings: SettingsResponse): SettingsResponse {
  const { preferences } = settings
  return {
    ...settings,
    preferences: {
      ...preferences,
      gitCredentials: preferences.gitCredentials?.map((credential) => ({
        ...credential,
        token: redactSecret(credential.token),
        sshPrivateKey: redactSecret(credential.sshPrivateKey),
        sshPrivateKeyEncrypted: redactSecret(credential.sshPrivateKeyEncrypted),
        passphrase: redactSecret(credential.passphrase),
      })),
      tts: preferences.tts && { ...preferences.tts, apiKey: redactSecret(preferences.tts.apiKey) },
      stt: preferences.stt && { ...preferences.stt, apiKey: redactSecret(preferences.stt.apiKey) },
      serverEnvVars: preferences.serverEnvVars?.map((envVar) => ({ ...envVar, value: redactSecret(envVar.value) })),
      lastKnownGoodConfig: redactSecret(preferences.lastKnownGoodConfig),
    },
  }
}

export function createInternalSettingsRoutes(settingsService: SettingsService) {
  const app = new Hono()

  app.get('/', (c) => {
    const userId = c.req.query('userId') ?? 'default'
    return c.json(redactInternalSettings(settingsService.getSettings(userId)))
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

    const patch = parsed.data
    const currentPrefs = settingsService.getSettings(userId).preferences
    const updates: Partial<UserPreferences> = {}
    for (const key of Object.keys(patch)) {
      if (key !== 'tts' && key !== 'stt') {
        (updates as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key]
      }
    }
    if (patch.tts) {
      if (!currentPrefs.tts?.apiKey) {
        return c.json({ error: 'TTS is not configured. Set up TTS (including credentials) in the UI before adjusting it.' }, 400)
      }
      updates.tts = { ...currentPrefs.tts, ...patch.tts }
    }
    if (patch.stt) {
      if (!currentPrefs.stt?.apiKey) {
        return c.json({ error: 'STT is not configured. Set up STT (including credentials) in the UI before adjusting it.' }, 400)
      }
      updates.stt = { ...currentPrefs.stt, ...patch.stt }
    }

    const updated = settingsService.updateSettings(updates as Partial<UserPreferences>, userId)
    return c.json(redactInternalSettings(updated))
  })

  return app
}
