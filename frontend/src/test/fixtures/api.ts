import {
  DEFAULT_USER_PREFERENCES as sharedDefaultUserPreferences,
  type SettingsResponse,
  type UserPreferences,
} from '@/api/types/settings'
import type { Repo } from '@/api/types'
import type { HealthResponse } from '@/hooks/useServerHealth'
import type { Model, Provider, ProviderCatalog } from '@/api/providers'
import type { ScheduleJobWithRepo, ScheduleRunWithContext } from '@/api/schedules'
import type {
  AssistantModeStatus,
  ScheduleJob,
  ScheduleRun,
} from '@opencode-manager/shared/types'
import type { OpenCodeServer, SessionSandboxState } from '@opencode-manager/shared/schemas'
import type { FormInfo, ModelInfo, SessionInfo, SessionMessageUser } from '@opencode-manager/shared/opencode'

export type DefaultUserPreferences = typeof sharedDefaultUserPreferences

export interface AuthConfigFixture {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

export interface AuthSessionFixture {
  session: {
    id: string
    userId: string
    token: string
    expiresAt: string
    createdAt: string
    updatedAt: string
  }
  user: {
    id: string
    email: string
    name: string
  }
}

export function makeUserPreferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return { ...sharedDefaultUserPreferences, ...overrides }
}

export function makeSettingsResponse(
  overrides: Partial<SettingsResponse> = {},
): SettingsResponse {
  const response: SettingsResponse = {
    preferences: makeUserPreferences(overrides.preferences),
    updatedAt: overrides.updatedAt ?? 1,
  }
  if (overrides.restartRequired !== undefined) response.restartRequired = overrides.restartRequired
  return response
}

export function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    name: 'demo',
    localPath: 'demo',
    fullPath: '/workspace/demo',
    defaultBranch: 'main',
    currentBranch: 'main',
    branch: 'main',
    cloneStatus: 'ready',
    clonedAt: 1,
    lastAccessedAt: 1,
    isLocal: true,
    ...overrides,
  }
}

export function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'ses_1',
    projectID: 'proj_1',
    title: 'Test session',
    time: { created: 1, updated: 1 },
    location: { directory: '/workspace/demo' },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  }
}

export function makeUserMessage(overrides: Partial<SessionMessageUser> = {}): SessionMessageUser {
  return {
    id: 'msg_1',
    type: 'user',
    text: 'Hello',
    time: { created: 1 },
    ...overrides,
  }
}

export function makeForm(overrides: Partial<FormInfo> = {}): FormInfo {
  return {
    id: 'form-1',
    sessionID: 'session-1',
    title: 'Continue',
    fields: [
      { key: 'q0', title: 'Confirm', type: 'string', options: [{ value: 'Yes', label: 'Yes' }] },
    ],
    ...overrides,
  }
}

export function makeOpenCodeServer(overrides: Partial<OpenCodeServer> = {}): OpenCodeServer {
  return {
    id: 'srv_1',
    name: 'Test server',
    baseUrl: 'https://opencode.example.com',
    username: 'opencode',
    enabled: true,
    hasPassword: true,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

export function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'anthropic/claude-sonnet-4-5',
    modelID: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    released: 1,
    free: false,
    ...overrides,
  }
}

export function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    models: [makeModel()],
    ...overrides,
  }
}

export function makeProviderCatalog(overrides: Partial<ProviderCatalog> = {}): ProviderCatalog {
  return {
    providers: [makeProvider()],
    models: [],
    ...overrides,
  }
}

export function makeAuthConfig(overrides: Partial<AuthConfigFixture> = {}): AuthConfigFixture {
  return {
    enabledProviders: ['credentials'],
    registrationEnabled: true,
    isFirstUser: false,
    adminConfigured: false,
    ...overrides,
  }
}

export function makeAuthSession(overrides: Partial<AuthSessionFixture> = {}): AuthSessionFixture {
  return {
    session: {
      id: 'test-session',
      userId: 'test-user',
      token: 'test-token',
      expiresAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides.session,
    },
    user: {
      id: 'test-user',
      email: 'test@example.com',
      name: 'Test User',
      ...overrides.user,
    },
  }
}

export function makeScheduleJob(overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 7,
    repoId: 1,
    name: 'Weekly summary',
    description: 'Summarize the week',
    enabled: true,
    showInInbox: true,
    scheduleMode: 'interval',
    intervalMinutes: 60,
    cronExpression: null,
    timezone: null,
    agentSlug: null,
    prompt: 'Summarize the week',
    model: null,
    skillMetadata: null,
    permissionConfig: null,
    mcpServers: [],
    branch: null,
    workspaceMode: 'worktree',
    sandbox: null,
    createdAt: 1,
    updatedAt: 2,
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  }
}

export function makeScheduleJobWithRepo(
  overrides: Partial<ScheduleJobWithRepo> = {},
): ScheduleJobWithRepo {
  return {
    ...makeScheduleJob(overrides),
    repoName: 'demo',
    repoPath: '/workspace/demo',
    repoUrl: 'https://example.com/demo.git',
    serverName: null,
    lastRun: null,
    retainedWorktreeCount: 0,
    ...overrides,
  }
}

export function makeScheduleRun(overrides: Partial<ScheduleRun> = {}): ScheduleRun {
  return {
    id: 1,
    jobId: 7,
    repoId: 1,
    triggerSource: 'manual',
    status: 'completed',
    startedAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    finishedAt: Date.UTC(2026, 2, 9, 12, 5, 0),
    viewedAt: 123,
    createdAt: Date.UTC(2026, 2, 9, 12, 0, 0),
    sessionId: 'ses_1',
    sessionTitle: 'Run title',
    logText: null,
    responseText: null,
    errorText: null,
    runBranch: null,
    commitHash: null,
    worktreePath: null,
    ...overrides,
  }
}

export function makeScheduleRunWithContext(
  overrides: Partial<ScheduleRunWithContext> = {},
): ScheduleRunWithContext {
  return {
    ...makeScheduleRun(overrides),
    jobName: 'Weekly summary',
    repoName: 'demo',
    repoPath: '/workspace/demo',
    serverName: null,
    ...overrides,
  }
}

export function makeAssistantModeStatus(
  overrides: Partial<AssistantModeStatus> = {},
): AssistantModeStatus {
  return {
    repoId: 0,
    directory: '/workspace/assistant',
    relativePath: 'repos/assistant',
    files: {
      agentsMd: { path: 'AGENTS.md', exists: true, created: false },
      opencodeJson: { path: 'opencode.json', exists: true, created: false },
    },
    ...overrides,
  }
}

export function makeHealthResponse(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return {
    status: 'healthy',
    timestamp: '2026-01-01T00:00:00.000Z',
    database: 'connected',
    opencode: 'healthy',
    opencodePort: 5551,
    opencodeVersion: '2.0.15',
    opencodeMinVersion: '2.0.0',
    opencodeVersionSupported: true,
    opencodeManagerVersion: '1.0.0',
    ...overrides,
  }
}

export interface CatalogProviderInfo {
  id: string
  name: string
  activation: 'auto' | 'enabled' | 'disabled'
  integrationID?: string
  package?: string
}

export function makeCatalogProvider(overrides: Partial<CatalogProviderInfo> = {}): CatalogProviderInfo {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    activation: 'enabled',
    package: '@opencode/ai/providers/anthropic',
    ...overrides,
  }
}

export function makeCatalogModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'claude-sonnet-4',
    modelID: 'claude-sonnet-4-20250514',
    providerID: 'anthropic',
    name: 'Claude Sonnet 4',
    capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
    variants: [],
    time: { released: Date.UTC(2025, 4, 22) },
    cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
    status: 'active',
    enabled: true,
    limit: { context: 200000, output: 64000 },
    ...overrides,
  }
}

export function makeSessionSandboxState(overrides: Partial<SessionSandboxState> = {}): SessionSandboxState {
  return {
    sessionId: 'ses_1',
    rootSessionId: 'ses_1',
    sandboxed: false,
    source: 'default',
    resources: null,
    effectiveResources: { cpus: 2, memoryMib: 4096 },
    lockedReason: null,
    available: true,
    ...overrides,
  }
}
