import { Hono } from 'hono'
import { AssistantSettingsPatchSchema } from '@opencode-manager/shared/schemas'
import type { SettingsService } from '../../services/settings'
import type { SettingsResponse, UserPreferences } from '@opencode-manager/shared/types'
import { OPENCODE_CONFIG_REDACTED_VALUE } from '../../services/opencode-config-file'
import { parseJsonBody } from '../../utils/route-helpers'

function redactSecret(value: string): string
function redactSecret(value: undefined): undefined
function redactSecret(value: string | undefined): string | undefined
function redactSecret(value: string | undefined): string | undefined {
  return value ? OPENCODE_CONFIG_REDACTED_VALUE : value
}

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

export type InternalSettingsRoutesService = Pick<SettingsService, 'getSettings' | 'updateSettings'>

export function createInternalSettingsRoutes(settingsService: InternalSettingsRoutesService) {
  const app = new Hono()

  app.get('/', (c) => {
    const userId = c.req.query('userId') ?? 'default'
    return c.json(redactInternalSettings(settingsService.getSettings(userId)))
  })

  app.patch('/', async (c) => {
    const userId = c.req.query('userId') ?? 'default'

    const body = await parseJsonBody(c, AssistantSettingsPatchSchema, { invalidBodyMessage: 'Invalid request body' })
    if (!body.ok) {
      return body.response
    }

    const patch = body.data
    const currentPrefs = settingsService.getSettings(userId).preferences
    const { tts, stt, ...restPatch } = patch
    const updates: Partial<UserPreferences> = { ...restPatch }
    if (tts) {
      if (!currentPrefs.tts?.apiKey) {
        return c.json({ error: 'TTS is not configured. Set up TTS (including credentials) in the UI before adjusting it.' }, 400)
      }
      updates.tts = { ...currentPrefs.tts, ...tts }
    }
    if (stt) {
      if (!currentPrefs.stt?.apiKey) {
        return c.json({ error: 'STT is not configured. Set up STT (including credentials) in the UI before adjusting it.' }, 400)
      }
      updates.stt = { ...currentPrefs.stt, ...stt }
    }

    const updated = settingsService.updateSettings(updates, userId)
    return c.json(redactInternalSettings(updated))
  })

  return app
}
