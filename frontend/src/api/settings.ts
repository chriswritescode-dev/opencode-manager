import type { 
  SettingsResponse, 
  UpdateSettingsRequest, 
  OpenCodeConfig,
  OpenCodeConfigResponse,
  CreateOpenCodeConfigRequest,
  UpdateOpenCodeConfigRequest,
  OpenCodeImportStatus,
  SyncOpenCodeImportResponse,
  SkillFileInfo,
  CreateSkillRequest,
  UpdateSkillRequest,
  SkillScope,
  InstallSkillFromGithubRequest,
  InstallSkillResponse,
  OpenCodeDirectoryFileInfo,
} from './types/settings'
import { API_BASE_URL } from '@/config'
import { fetchWrapper, FetchError } from './fetchWrapper'

const DEFAULT_USER_ID = 'default'

function appendFilesWithManifest(formData: FormData, files: File[]): void {
  const fileManifest: Array<{ fieldName: string; relativePath: string }> = []

  files.forEach((file, index) => {
    const fieldName = `file${index}`
    const relativePath = file.webkitRelativePath || file.name
    fileManifest.push({ fieldName, relativePath })
    formData.append(fieldName, file)
  })

  formData.append('fileManifest', JSON.stringify(fileManifest))
}

export const settingsApi = {
  getSettings: async (userId = DEFAULT_USER_ID): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      params: { userId },
    })
  },

  updateSettings: async (
    updates: UpdateSettingsRequest,
    userId = DEFAULT_USER_ID
  ): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      method: 'PATCH',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  },

  resetSettings: async (userId = DEFAULT_USER_ID): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      method: 'DELETE',
      params: { userId },
    })
  },

  getOpenCodeConfigs: async (userId = DEFAULT_USER_ID): Promise<OpenCodeConfigResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-configs`, {
      params: { userId },
    })
  },

  createOpenCodeConfig: async (
    request: CreateOpenCodeConfigRequest,
    userId = DEFAULT_USER_ID
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
    userId = DEFAULT_USER_ID
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
    userId = DEFAULT_USER_ID
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
    userId = DEFAULT_USER_ID
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

  getDefaultOpenCodeConfig: async (userId = DEFAULT_USER_ID): Promise<OpenCodeConfig | null> => {
    try {
      return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-configs/default`, {
        params: { userId },
      })
    } catch {
      return null
    }
  },

  discoverOpenCodeModels: async (
    baseUrl: string,
    apiKey?: string,
    forceRefresh = false,
  ): Promise<{ models: string[]; cached: boolean }> => {
    const params: Record<string, string> = { baseUrl }
    if (apiKey) params.apiKey = apiKey
    if (forceRefresh) params.refresh = 'true'
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-discover-models`, {
      params,
    })
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

  getOpenCodeImportStatus: async (): Promise<OpenCodeImportStatus> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-import/status`)
  },

  syncOpenCodeImport: async (overwriteState = false): Promise<SyncOpenCodeImportResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overwriteState }),
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

  getVersionInfo: async (): Promise<VersionInfo> => {
    return fetchWrapper(`${API_BASE_URL}/api/health/version`)
  },

  listManagedSkills: async (repoId?: number, directory?: string): Promise<SkillFileInfo[]> => {
    const searchParams = new URLSearchParams()
    if (repoId) searchParams.set('repoId', String(repoId))
    if (directory) searchParams.set('directory', directory)
    const query = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills${query}`)
  },

  getSkill: async (name: string, scope: SkillScope, repoId?: number): Promise<SkillFileInfo> => {
    const params = new URLSearchParams({ scope })
    if (repoId) params.set('repoId', String(repoId))
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/${name}?${params}`)
  },

  createSkill: async (data: CreateSkillRequest): Promise<SkillFileInfo> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  updateSkill: async (name: string, scope: SkillScope, data: UpdateSkillRequest, repoId?: number): Promise<SkillFileInfo> => {
    const params = new URLSearchParams({ scope })
    if (repoId) params.set('repoId', String(repoId))
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/${name}?${params}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  deleteSkill: async (name: string, scope: SkillScope, repoId?: number): Promise<{ success: boolean }> => {
    const params = new URLSearchParams({ scope })
    if (repoId) params.set('repoId', String(repoId))
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/${name}?${params}`, {
      method: 'DELETE',
    })
  },

  installSkillFromGithub: async (data: InstallSkillFromGithubRequest): Promise<InstallSkillResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  installSkillFromUpload: async (data: {
    files: File[]
    scope: SkillScope
    repoId?: number
    overwrite?: boolean
  }): Promise<InstallSkillResponse> => {
    const formData = new FormData()
    formData.append('sourceType', 'upload')
    formData.append('scope', data.scope)
    if (data.repoId !== undefined) formData.append('repoId', String(data.repoId))
    if (data.overwrite !== undefined) formData.append('overwrite', String(data.overwrite))

    appendFilesWithManifest(formData, data.files)

    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/install`, {
      method: 'POST',
      body: formData,
    })
  },

  installOpenCodeDirectoryFiles: async (data: {
    kind: 'agents' | 'commands'
    files: File[]
  }): Promise<{ kind: 'agents' | 'commands'; filesInstalled: string[] }> => {
    const formData = new FormData()
    formData.append('kind', data.kind)

    appendFilesWithManifest(formData, data.files)

    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files/install`, {
      method: 'POST',
      body: formData,
    })
  },

  listOpenCodeDirectoryFiles: async (kind: 'agents' | 'commands'): Promise<OpenCodeDirectoryFileInfo[]> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files`, {
      params: { kind },
    })
  },

  getOpenCodeDirectoryFile: async (
    kind: 'agents' | 'commands',
    relativePath: string,
  ): Promise<OpenCodeDirectoryFileInfo & { content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files/content`, {
      params: { kind, relativePath },
    })
  },

  updateOpenCodeDirectoryFile: async (data: {
    kind: 'agents' | 'commands'
    relativePath: string
    content: string
  }): Promise<OpenCodeDirectoryFileInfo> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  deleteOpenCodeDirectoryFile: async (
    kind: 'agents' | 'commands',
    relativePath: string,
  ): Promise<{ kind: 'agents' | 'commands'; relativePath: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files`, {
      method: 'DELETE',
      params: { kind, relativePath },
    })
  },

  getManagerUpgradeStatus: async (): Promise<ManagerUpgradeStatus> => {
    return fetchWrapper(`${API_BASE_URL}/api/manager-upgrade/status`)
  },

  startManagerUpgrade: async (version?: string): Promise<{ job: ManagerUpgradeJob }> => {
    return fetchWrapper(`${API_BASE_URL}/api/manager-upgrade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(version ? { version } : {}),
    })
  },
}

export interface VersionInfo {
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  releaseName: string | null
}

export interface OpenCodeServerAuthStatus {
  isSet: boolean
  source: 'db' | 'env' | 'none'
}

export async function getOpenCodeServerAuth(): Promise<OpenCodeServerAuthStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-server-auth`)
}

export async function updateOpenCodeServerAuth(password: string | null): Promise<OpenCodeServerAuthStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-server-auth`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

export interface ManagerTokenResponse {
  token: string
}

export async function getManagerToken(): Promise<ManagerTokenResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/manager-token`)
}

export async function rotateManagerToken(): Promise<ManagerTokenResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/manager-token/rotate`, {
    method: 'POST',
  })
}

export type ManagerUpgradeJobStatus = 'pending' | 'pulling' | 'recreating' | 'completed' | 'failed'

export interface ManagerUpgradeJob {
  id: number
  status: ManagerUpgradeJobStatus
  fromVersion: string | null
  toVersion: string | null
  targetImage: string | null
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export interface ManagerUpgradeStatus {
  supported: boolean
  inDocker: boolean
  socketAvailable: boolean
  enabled: boolean
  currentVersion: string | null
  job: ManagerUpgradeJob | null
}
