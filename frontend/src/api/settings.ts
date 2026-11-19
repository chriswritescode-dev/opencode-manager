import type { 
  SettingsResponse, 
  UpdateSettingsRequest, 
  OpenCodeConfigFile,
  OpenCodeConfigSaveResponse,
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
  OpenCodeRestartResponse,
  ManagedOpenCodeConfig,
  UpdateOpenCodeConfigPatchRequest,
} from './types/settings'
import { z } from 'zod'
import {
  OpenCodeConfigFileSchema,
  RepoSchema,
  SettingsResponseSchema,
} from '@opencode-manager/shared/schemas'
import { OpenCodeManagedConfigSectionsSchema } from '@opencode-manager/shared/opencode'
import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

const DEFAULT_USER_ID = 'default'

type OpenCodeDiscoveryParams = {
  baseUrl: string
  apiKey?: string
  refresh?: string
}

const settingsResponseSchema: z.ZodType<SettingsResponse> = SettingsResponseSchema.extend({
  restartRequired: z.boolean().optional(),
})

const openCodeConfigSaveResponseSchema: z.ZodType<OpenCodeConfigSaveResponse> = OpenCodeConfigFileSchema.extend({
  restartRequired: z.boolean().optional(),
})

const openCodeRestartResponseSchema: z.ZodType<OpenCodeRestartResponse> = z.object({
  success: z.boolean(),
  message: z.string(),
})

const openCodeImportStatusBaseSchema = z.object({
  configSourcePath: z.string().nullable(),
  configSourcePaths: z.array(z.string()),
  stateSourcePath: z.string().nullable(),
  workspaceConfigPath: z.string(),
  workspaceConfigPathsToRemove: z.array(z.string()),
  workspaceStatePath: z.string(),
  workspaceStateExists: z.boolean(),
})

const relinkedReposSchema = z.object({
  repos: z.array(RepoSchema),
  relinkedCount: z.number(),
  existingCount: z.number(),
  nonRepoPathCount: z.number(),
  duplicatePathCount: z.number(),
  errors: z.array(z.object({ path: z.string(), error: z.string() })),
})

const openCodeImportStatusSchema: z.ZodType<OpenCodeImportStatus> = openCodeImportStatusBaseSchema

const syncOpenCodeImportResponseSchema: z.ZodType<SyncOpenCodeImportResponse> = openCodeImportStatusBaseSchema.extend({
  success: z.boolean(),
  message: z.string(),
  serverRestarted: z.boolean(),
  configImported: z.boolean(),
  stateImported: z.boolean(),
  relinkedRepos: relinkedReposSchema.optional(),
})

const openCodeDirectoryFileInfoBaseSchema = z.object({
  kind: z.enum(['agents', 'commands']),
  name: z.string(),
  relativePath: z.string(),
})

const openCodeDirectoryFileInfoSchema: z.ZodType<OpenCodeDirectoryFileInfo> = openCodeDirectoryFileInfoBaseSchema

const openCodeDirectoryFileContentSchema: z.ZodType<OpenCodeDirectoryFileInfo & { content: string }> = openCodeDirectoryFileInfoBaseSchema.extend({
  content: z.string(),
})

const managedOpenCodeConfigSchema: z.ZodType<ManagedOpenCodeConfig> = z.object({
  info: OpenCodeManagedConfigSectionsSchema,
})

const openCodeModelsResponseSchema = z.object({ models: z.array(z.string()), cached: z.boolean() })

const activeOpenCodeSessionsResponseSchema = z.object({
  count: z.number(),
  sessions: z.array(z.object({ sessionID: z.string(), directory: z.string() })),
})

const openCodeVersionsResponseSchema = z.object({
  versions: z.array(
    z.object({
      version: z.string(),
      tag: z.string(),
      name: z.string(),
      publishedAt: z.string(),
    }),
  ),
  currentVersion: z.string().nullable(),
})

const installOpenCodeVersionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  oldVersion: z.string().optional(),
  newVersion: z.string().optional(),
  recovered: z.boolean().optional(),
  recoveryMessage: z.string().optional(),
})

const upgradeOpenCodeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  oldVersion: z.string().optional(),
  newVersion: z.string().optional(),
  upgraded: z.boolean(),
  recovered: z.boolean().optional(),
  recoveryMessage: z.string().optional(),
})

const sshTestResponseSchema = z.object({ success: z.boolean(), message: z.string() })

const agentsMdResponseSchema = z.object({ content: z.string() })

const versionInfoSchema: z.ZodType<VersionInfo> = z.object({
  currentVersion: z.string().nullable(),
  latestVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  releaseUrl: z.string().nullable(),
  releaseName: z.string().nullable(),
})

const openCodeServerAuthStatusSchema: z.ZodType<OpenCodeServerAuthStatus> = z.object({
  isSet: z.boolean(),
  source: z.enum(['db', 'env', 'managed']),
})

const managerTokenResponseSchema: z.ZodType<ManagerTokenResponse> = z.object({ token: z.string() })

const agentsMdUpdateResponseSchema = z.object({ success: z.boolean(), restartRequired: z.boolean().optional() })

const skillFileInfoBaseSchema = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  scope: z.enum(['global', 'project']),
  location: z.string(),
  repoId: z.number().optional(),
  repoName: z.string().optional(),
})

const skillFileInfoSchema: z.ZodType<SkillFileInfo> = skillFileInfoBaseSchema

const skillFileInfoListSchema = z.array(skillFileInfoSchema)

const skillFileInfoResponseSchema = skillFileInfoBaseSchema.extend({ restartRequired: z.boolean().optional() })

const installSkillResponseSchema: z.ZodType<InstallSkillResponse & { restartRequired?: boolean }> = z.object({
  skill: skillFileInfoSchema,
  overwritten: z.boolean(),
  sourceType: z.enum(['github', 'upload']),
  filesInstalled: z.array(z.string()),
  restartRequired: z.boolean().optional(),
})

const successResponseSchema = z.object({ success: z.boolean() })

const skillDeleteResponseSchema = successResponseSchema.extend({ restartRequired: z.boolean().optional() })

const kindFilesInstalledResponseSchema = z.object({
  kind: z.enum(['agents', 'commands']),
  filesInstalled: z.array(z.string()),
  restartRequired: z.boolean().optional(),
})

const directoryFileInfoSchema = openCodeDirectoryFileInfoBaseSchema.extend({ restartRequired: z.boolean().optional() })

const directoryFileRefSchema = z.object({
  kind: z.enum(['agents', 'commands']),
  relativePath: z.string(),
  restartRequired: z.boolean().optional(),
})

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
    return fetchWrapper(`${API_BASE_URL}/api/settings`, settingsResponseSchema, {
      params: { userId },
    })
  },

  updateSettings: async (
    updates: UpdateSettingsRequest,
    userId = DEFAULT_USER_ID
  ): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, settingsResponseSchema, {
      method: 'PATCH',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  },

  resetSettings: async (userId = DEFAULT_USER_ID): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, settingsResponseSchema, {
      method: 'DELETE',
      params: { userId },
    })
  },

  getOpenCodeConfig: async (): Promise<OpenCodeConfigFile> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-config`, OpenCodeConfigFileSchema)
  },

  updateOpenCodeConfig: async (
    request: UpdateOpenCodeConfigRequest
  ): Promise<OpenCodeConfigSaveResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-config`, openCodeConfigSaveResponseSchema, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  },

  getManagedOpenCodeConfig: async (): Promise<ManagedOpenCodeConfig> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-config/managed`, managedOpenCodeConfigSchema)
  },

  patchOpenCodeConfig: async (
    request: UpdateOpenCodeConfigPatchRequest
  ): Promise<OpenCodeConfigSaveResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-config`, openCodeConfigSaveResponseSchema, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  },

  discoverOpenCodeModels: async (
    baseUrl: string,
    apiKey?: string,
    forceRefresh = false,
  ): Promise<{ models: string[]; cached: boolean }> => {
    const params: OpenCodeDiscoveryParams = { baseUrl }
    if (apiKey) params.apiKey = apiKey
    if (forceRefresh) params.refresh = 'true'
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-discover-models`, openCodeModelsResponseSchema, {
      params,
    })
  },

  restartOpenCodeServer: async (): Promise<OpenCodeRestartResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-restart`, openCodeRestartResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  getActiveOpenCodeSessions: async (): Promise<{ count: number; sessions: { sessionID: string; directory: string }[] }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-active-sessions`, activeOpenCodeSessionsResponseSchema)
  },

  getOpenCodeImportStatus: async (): Promise<OpenCodeImportStatus> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-import/status`, openCodeImportStatusSchema)
  },

  syncOpenCodeImport: async (overwriteState = false): Promise<SyncOpenCodeImportResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-import`, syncOpenCodeImportResponseSchema, {
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
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-versions`, openCodeVersionsResponseSchema)
  },

  installOpenCodeVersion: async (version: string): Promise<{
    success: boolean
    message: string
    oldVersion?: string
    newVersion?: string
    recovered?: boolean
    recoveryMessage?: string
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-install-version`, installOpenCodeVersionResponseSchema, {
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
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-upgrade`, upgradeOpenCodeResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  testSSHConnection: async (host: string, sshPrivateKey: string, passphrase?: string): Promise<{ success: boolean; message: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/test-ssh`, sshTestResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, sshPrivateKey, passphrase }),
    })
  },

  getAgentsMd: async (): Promise<{ content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md`, agentsMdResponseSchema)
  },

  getDefaultAgentsMd: async (): Promise<{ content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md/default`, agentsMdResponseSchema)
  },

  updateAgentsMd: async (content: string): Promise<{ success: boolean; restartRequired?: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md`, agentsMdUpdateResponseSchema, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  },

  getVersionInfo: async (): Promise<VersionInfo> => {
    return fetchWrapper(`${API_BASE_URL}/api/health/version`, versionInfoSchema)
  },

  listManagedSkills: async (repoId?: number, directory?: string): Promise<SkillFileInfo[]> => {
    const searchParams = new URLSearchParams()
    if (repoId) searchParams.set('repoId', String(repoId))
    if (directory) searchParams.set('directory', directory)
    const query = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills${query}`, skillFileInfoListSchema)
  },

  getSkill: async (name: string, scope: SkillScope, repoId?: number): Promise<SkillFileInfo> => {
    const params = new URLSearchParams({ scope })
    if (repoId) params.set('repoId', String(repoId))
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/${name}?${params}`, skillFileInfoSchema)
  },

  createSkill: async (data: CreateSkillRequest): Promise<SkillFileInfo & { restartRequired?: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills`, skillFileInfoResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  updateSkill: async (name: string, scope: SkillScope, data: UpdateSkillRequest, repoId?: number): Promise<SkillFileInfo & { restartRequired?: boolean }> => {
    const params = new URLSearchParams({ scope })
    if (repoId) params.set('repoId', String(repoId))
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/${name}?${params}`, skillFileInfoResponseSchema, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  deleteSkill: async (name: string, scope: SkillScope, repoId?: number): Promise<{ success: boolean; restartRequired?: boolean }> => {
    const params = new URLSearchParams({ scope })
    if (repoId) params.set('repoId', String(repoId))
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/${name}?${params}`, skillDeleteResponseSchema, {
      method: 'DELETE',
    })
  },

  installSkillFromGithub: async (data: InstallSkillFromGithubRequest): Promise<InstallSkillResponse & { restartRequired?: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/install`, installSkillResponseSchema, {
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
  }): Promise<InstallSkillResponse & { restartRequired?: boolean }> => {
    const formData = new FormData()
    formData.append('sourceType', 'upload')
    formData.append('scope', data.scope)
    if (data.repoId !== undefined) formData.append('repoId', String(data.repoId))
    if (data.overwrite !== undefined) formData.append('overwrite', String(data.overwrite))

    appendFilesWithManifest(formData, data.files)

    return fetchWrapper(`${API_BASE_URL}/api/settings/skills/install`, installSkillResponseSchema, {
      method: 'POST',
      body: formData,
    })
  },

  installOpenCodeDirectoryFiles: async (data: {
    kind: 'agents' | 'commands'
    files: File[]
  }): Promise<{ kind: 'agents' | 'commands'; filesInstalled: string[]; restartRequired?: boolean }> => {
    const formData = new FormData()
    formData.append('kind', data.kind)

    appendFilesWithManifest(formData, data.files)

    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files/install`, kindFilesInstalledResponseSchema, {
      method: 'POST',
      body: formData,
    })
  },

  listOpenCodeDirectoryFiles: async (kind: 'agents' | 'commands'): Promise<OpenCodeDirectoryFileInfo[]> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files`, z.array(openCodeDirectoryFileInfoSchema), {
      params: { kind },
    })
  },

  getOpenCodeDirectoryFile: async (
    kind: 'agents' | 'commands',
    relativePath: string,
  ): Promise<OpenCodeDirectoryFileInfo & { content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files/content`, openCodeDirectoryFileContentSchema, {
      params: { kind, relativePath },
    })
  },

  updateOpenCodeDirectoryFile: async (data: {
    kind: 'agents' | 'commands'
    relativePath: string
    content: string
  }): Promise<OpenCodeDirectoryFileInfo & { restartRequired?: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files`, directoryFileInfoSchema, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  },

  deleteOpenCodeDirectoryFile: async (
    kind: 'agents' | 'commands',
    relativePath: string,
  ): Promise<{ kind: 'agents' | 'commands'; relativePath: string; restartRequired?: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-directory-files`, directoryFileRefSchema, {
      method: 'DELETE',
      params: { kind, relativePath },
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
  source: 'db' | 'env' | 'managed'
}

export async function getOpenCodeServerAuth(): Promise<OpenCodeServerAuthStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-server-auth`, openCodeServerAuthStatusSchema)
}

export async function updateOpenCodeServerAuth(password: string | null): Promise<OpenCodeServerAuthStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/opencode-server-auth`, openCodeServerAuthStatusSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

export interface ManagerTokenResponse {
  token: string
}

const rotatedManagerTokenResponseSchema: z.ZodType<ManagerTokenResponse & { restartRequired?: boolean }> = z.object({
  token: z.string(),
  restartRequired: z.boolean().optional(),
})

export async function getManagerToken(): Promise<ManagerTokenResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/manager-token`, managerTokenResponseSchema)
}

export async function rotateManagerToken(): Promise<ManagerTokenResponse & { restartRequired?: boolean }> {
  return fetchWrapper(`${API_BASE_URL}/api/settings/manager-token/rotate`, rotatedManagerTokenResponseSchema, {
    method: 'POST',
  })
}
