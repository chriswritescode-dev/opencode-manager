import { z } from 'zod'
import { UserPreferencesSchema } from '@opencode-manager/shared/schemas'
import type { UserPreferences } from '@/api/types/settings'
import type { FetchRoute, FetchRouteResult } from '../fetchFake'
import { makeSettingsResponse, makeUserPreferences } from './api'

const preferencesPatchSchema = z.object({ preferences: UserPreferencesSchema.partial() })

export interface SettingsServerOptions {
  patch?: () => FetchRouteResult | Promise<FetchRouteResult>
}

export interface SettingsServer {
  preferences: () => UserPreferences
  routes: FetchRoute[]
}

export function createSettingsServer(
  initial: Partial<UserPreferences> = {},
  options: SettingsServerOptions = {},
): SettingsServer {
  let preferences = makeUserPreferences(initial)

  const getRoute: FetchRoute = {
    method: 'GET',
    path: '/api/settings',
    respond: () => ({ json: makeSettingsResponse({ preferences }) }),
  }

  const patchRoute: FetchRoute = {
    method: 'PATCH',
    path: '/api/settings',
    respond: async (request) => {
      if (options.patch) return options.patch()
      const parsed = preferencesPatchSchema.parse(request.body)
      preferences = { ...preferences, ...parsed.preferences }
      return { json: makeSettingsResponse({ preferences }) }
    },
  }

  return {
    preferences: () => preferences,
    routes: [getRoute, patchRoute],
  }
}
