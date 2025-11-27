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

  restartOpenCodeServer: async (): Promise<{ success: boolean; message: string }> => {
    const { data } = await axios.post(`${API_BASE_URL}/api/settings/opencode-restart`)
    return data
  },
}
