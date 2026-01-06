import { apiClient, API_BASE_URL } from '@/lib/api'
import type { 
  SettingsResponse, 
  UpdateSettingsRequest, 
  OpenCodeConfig,
  OpenCodeConfigResponse,
  CreateOpenCodeConfigRequest,
  UpdateOpenCodeConfigRequest
} from './types/settings'

export const settingsApi = {
  getSettings: async (userId = 'default'): Promise<SettingsResponse> => {
    const { data } = await apiClient.get(`${API_BASE_URL}/api/settings`, {
      params: { userId },
    })
    return data
  },

  updateSettings: async (
    updates: UpdateSettingsRequest,
    userId = 'default'
  ): Promise<SettingsResponse> => {
    const { data } = await apiClient.patch(`${API_BASE_URL}/api/settings`, updates, {
      params: { userId },
    })
    return data
  },

  resetSettings: async (userId = 'default'): Promise<SettingsResponse> => {
    const { data } = await apiClient.delete(`${API_BASE_URL}/api/settings`, {
      params: { userId },
    })
    return data
  },

  getOpenCodeConfigs: async (userId = 'default'): Promise<OpenCodeConfigResponse> => {
    const { data } = await apiClient.get(`${API_BASE_URL}/api/settings/opencode-configs`, {
      params: { userId },
    })
    return data
  },

  createOpenCodeConfig: async (
    request: CreateOpenCodeConfigRequest,
    userId = 'default'
  ): Promise<OpenCodeConfig> => {
    const { data } = await apiClient.post(`${API_BASE_URL}/api/settings/opencode-configs`, request, {
      params: { userId },
    })
    return data
  },

  updateOpenCodeConfig: async (
    configName: string,
    request: UpdateOpenCodeConfigRequest,
    userId = 'default'
  ): Promise<OpenCodeConfig> => {
    const { data } = await apiClient.put(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}`,
      request,
      { params: { userId } }
    )
    return data
  },

  deleteOpenCodeConfig: async (
    configName: string,
    userId = 'default'
  ): Promise<boolean> => {
    await apiClient.delete(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}`,
      { params: { userId } }
    )
    return true
  },

  setDefaultOpenCodeConfig: async (
    configName: string,
    userId = 'default'
  ): Promise<OpenCodeConfig> => {
    const { data } = await apiClient.post(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}/set-default`,
      {},
      { params: { userId } }
    )
    return data
  },

  getDefaultOpenCodeConfig: async (userId = 'default'): Promise<OpenCodeConfig | null> => {
    try {
      const { data } = await apiClient.get(`${API_BASE_URL}/api/settings/opencode-configs/default`, {
        params: { userId },
      })
      return data
    } catch {
      return null
    }
  },

  restartOpenCodeServer: async (): Promise<{ success: boolean; message: string; details?: string }> => {
    const { data } = await apiClient.post(`${API_BASE_URL}/api/settings/opencode-restart`)
    return data
  },

  rollbackOpenCodeConfig: async (): Promise<{ success: boolean; message: string; configName?: string }> => {
    const { data } = await apiClient.post(`${API_BASE_URL}/api/settings/opencode-rollback`)
    return data
  },

  getAgentsMd: async (): Promise<{ content: string }> => {
    const { data } = await apiClient.get(`${API_BASE_URL}/api/settings/agents-md`)
    return data
  },

  getDefaultAgentsMd: async (): Promise<{ content: string }> => {
    const { data } = await apiClient.get(`${API_BASE_URL}/api/settings/agents-md/default`)
    return data
  },

  updateAgentsMd: async (content: string): Promise<{ success: boolean }> => {
    const { data } = await apiClient.put(`${API_BASE_URL}/api/settings/agents-md`, { content })
    return data
  },

  validateGitToken: async (gitToken: string): Promise<{ valid: boolean; message: string }> => {
    const { data } = await apiClient.post(`${API_BASE_URL}/api/settings/validate-git-token`, { gitToken })
    return data
  },
}
