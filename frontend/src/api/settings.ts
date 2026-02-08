import type { 
  SettingsResponse, 
  UpdateSettingsRequest, 
  OpenCodeConfig,
  OpenCodeConfigResponse,
  CreateOpenCodeConfigRequest,
  UpdateOpenCodeConfigRequest
} from './types/settings'
import { API_BASE_URL } from '@/config'
import { fetchWrapper, FetchError } from './fetchWrapper'

export const settingsApi = {
  getSettings: async (userId = 'default'): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      params: { userId },
    })
  },

  updateSettings: async (
    updates: UpdateSettingsRequest,
    userId = 'default'
  ): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      method: 'PATCH',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  },

  resetSettings: async (userId = 'default'): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      method: 'DELETE',
      params: { userId },
    })
  },

  getOpenCodeConfigs: async (userId = 'default'): Promise<OpenCodeConfigResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-configs`, {
      params: { userId },
    })
  },

  createOpenCodeConfig: async (
    request: CreateOpenCodeConfigRequest,
    userId = 'default'
  ): Promise<OpenCodeConfig> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-configs`, {
      method: 'POST',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  },

  updateOpenCodeConfig: async (
    configName: string,
    request: UpdateOpenCodeConfigRequest,
    userId = 'default'
  ): Promise<OpenCodeConfig> => {
    return fetchWrapper(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}`,
      {
        method: 'PUT',
        params: { userId },
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    )
  },

  deleteOpenCodeConfig: async (
    configName: string,
    userId = 'default'
  ): Promise<boolean> => {
    await fetchWrapper(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}`,
      {
        method: 'DELETE',
        params: { userId },
      }
    )
    return true
  },

  setDefaultOpenCodeConfig: async (
    configName: string,
    userId = 'default'
  ): Promise<OpenCodeConfig> => {
    return fetchWrapper(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}/set-default`,
      {
        method: 'POST',
        params: { userId },
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    )
  },

  getDefaultOpenCodeConfig: async (userId = 'default'): Promise<OpenCodeConfig | null> => {
    try {
      return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-configs/default`, {
        params: { userId },
      })
    } catch {
      return null
    }
  },

  restartOpenCodeServer: async (): Promise<{ success: boolean; message: string; details?: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  reloadOpenCodeConfig: async (): Promise<{ success: boolean; message: string; details?: string }> => {
    try {
      return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      if (error instanceof FetchError && error.statusCode === 404) {
        return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-restart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw error
    }
  },

  rollbackOpenCodeConfig: async (): Promise<{ success: boolean; message: string; configName?: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  getOpenCodeVersions: async (): Promise<{
    versions: Array<{
      version: string
      tag: string
      name: string
      publishedAt: string
    }>
    currentVersion: string | null
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-versions`)
  },

  installOpenCodeVersion: async (version: string): Promise<{
    success: boolean
    message: string
    oldVersion?: string
    newVersion?: string
    recovered?: boolean
    recoveryMessage?: string
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-install-version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    })
  },

  upgradeOpenCode: async (): Promise<{
    success: boolean
    message: string
    oldVersion?: string
    newVersion?: string
    upgraded: boolean
    recovered?: boolean
    recoveryMessage?: string
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-upgrade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  testSSHConnection: async (host: string, sshPrivateKey: string, passphrase?: string): Promise<{ success: boolean; message: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/test-ssh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, sshPrivateKey, passphrase }),
    })
  },

  getAgentsMd: async (): Promise<{ content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md`)
  },

  getDefaultAgentsMd: async (): Promise<{ content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md/default`)
  },

  updateAgentsMd: async (content: string): Promise<{ success: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  },
}
