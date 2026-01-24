import axios from 'axios'
import type { 
  SettingsResponse, 
  UpdateSettingsRequest, 
  OpenCodeConfig,
  OpenCodeConfigResponse,
  CreateOpenCodeConfigRequest,
  UpdateOpenCodeConfigRequest
} from './types/settings'
import { API_BASE_URL } from '@/config'

export const settingsApi = {
  getSettings: async (userId = 'default'): Promise<SettingsResponse> => {
    const { data } = await axios.get(`${API_BASE_URL}/api/settings`, {
      params: { userId },
    })
    return data
  },

  updateSettings: async (
    updates: UpdateSettingsRequest,
    userId = 'default'
  ): Promise<SettingsResponse> => {
    const { data } = await axios.patch(`${API_BASE_URL}/api/settings`, updates, {
      params: { userId },
    })
    return data
  },

  resetSettings: async (userId = 'default'): Promise<SettingsResponse> => {
    const { data } = await axios.delete(`${API_BASE_URL}/api/settings`, {
      params: { userId },
    })
    return data
  },

  getOpenCodeConfigs: async (userId = 'default'): Promise<OpenCodeConfigResponse> => {
    const { data } = await axios.get(`${API_BASE_URL}/api/settings/opencode-configs`, {
      params: { userId },
    })
    return data
  },

  createOpenCodeConfig: async (
    request: CreateOpenCodeConfigRequest,
    userId = 'default'
  ): Promise<OpenCodeConfig> => {
    const { data } = await axios.post(`${API_BASE_URL}/api/settings/opencode-configs`, request, {
      params: { userId },
    })
    return data
  },

  updateOpenCodeConfig: async (
    configName: string,
    request: UpdateOpenCodeConfigRequest,
    userId = 'default'
  ): Promise<OpenCodeConfig> => {
    const { data } = await axios.put(
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
    await axios.delete(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}`,
      { params: { userId } }
    )
    return true
  },

  setDefaultOpenCodeConfig: async (
    configName: string,
    userId = 'default'
  ): Promise<OpenCodeConfig> => {
    const { data } = await axios.post(
      `${API_BASE_URL}/api/settings/opencode-configs/${encodeURIComponent(configName)}/set-default`,
      {},
      { params: { userId } }
    )
    return data
  },

  getDefaultOpenCodeConfig: async (userId = 'default'): Promise<OpenCodeConfig | null> => {
    try {
      const { data } = await axios.get(`${API_BASE_URL}/api/settings/opencode-configs/default`, {
        params: { userId },
      })
      return data
    } catch {
      return null
    }
  },

  restartOpenCodeServer: async (): Promise<{ success: boolean; message: string; details?: string }> => {
    const { data } = await axios.post(`${API_BASE_URL}/api/settings/opencode-restart`)
    return data
  },

  reloadOpenCodeConfig: async (): Promise<{ success: boolean; message: string; details?: string }> => {
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/settings/opencode-reload`)
      return data
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        const result = await axios.post(`${API_BASE_URL}/api/settings/opencode-restart`)
        return result.data
      }
      throw error
    }
  },

  rollbackOpenCodeConfig: async (): Promise<{ success: boolean; message: string; configName?: string }> => {
    const { data } = await axios.post(`${API_BASE_URL}/api/settings/opencode-rollback`)
    return data
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
    const { data } = await axios.get(`${API_BASE_URL}/api/settings/opencode-versions`)
    return data
  },

  installOpenCodeVersion: async (version: string): Promise<{
    success: boolean
    message: string
    oldVersion?: string
    newVersion?: string
  }> => {
    const { data } = await axios.post(`${API_BASE_URL}/api/settings/opencode-install-version`, { version })
    return data
  },

  upgradeOpenCode: async (): Promise<{ success: boolean; message: string; oldVersion?: string; newVersion?: string; upgraded: boolean }> => {
    const { data } = await axios.post(`${API_BASE_URL}/api/settings/opencode-upgrade`)
    return data
  },

  getAgentsMd: async (): Promise<{ content: string }> => {
    const { data } = await axios.get(`${API_BASE_URL}/api/settings/agents-md`)
    return data
  },

  getDefaultAgentsMd: async (): Promise<{ content: string }> => {
    const { data } = await axios.get(`${API_BASE_URL}/api/settings/agents-md/default`)
    return data
  },

  updateAgentsMd: async (content: string): Promise<{ success: boolean }> => {
    const { data } = await axios.put(`${API_BASE_URL}/api/settings/agents-md`, { content })
    return data
  },
}
