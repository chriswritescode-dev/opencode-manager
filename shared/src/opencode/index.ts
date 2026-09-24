import { OpenCode } from '@opencode/client'

export type {
  AgentInfo,
  CommandInfo,
  FileDiffInfo,
  FormAnswer,
  FormField,
  FormInfo,
  IntegrationInfo,
  IntegrationMethod,
  McpServer,
  ModelInfo,
  ModelRef,
  OpenCodeEvent,
  PermissionRequest,
  PromptAgentAttachment,
  PromptFileAttachment,
  PromptMention,
  PromptSkillAttachment,
  ProviderInfo,
  SessionInfo,
  SessionInboxCompaction,
  SessionInboxInfo,
  SessionInboxMove,
  SessionInboxSynthetic,
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantRetry,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
  SessionRevert,
  SessionStatus,
  SessionStructuredError,
  SessionTransferData,
  SessionsResponse,
  SkillInfo,
  ToolContent,
  ToolFileContent,
  ToolTextContent,
  V2Event,
  WorktreeError,
} from '@opencode/client'

export { ClientError, isMcpServerNotFoundError, isWorktreeError } from '@opencode/client'

export {
  MCP_OAUTH_CALLBACK_PATH,
  fromV2McpServerConfig,
  mcpOAuthRedirectUri,
  mcpServerConfigFromConfig,
  mcpServersFromConfig,
  mcpStatusByName,
  toV2McpServerConfig,
} from './mcp'

export type {
  McpOAuthConfig,
  McpServerConfig,
  McpStatus,
  McpStatusMap,
  McpStatusName,
  V2McpLocalConfig,
  V2McpOAuthConfig,
  V2McpRemoteConfig,
  V2McpServerConfig,
  V2McpTimeoutConfig,
} from './mcp'

export {
  OPENCODE_MIN_VERSION,
  OPENCODE_PINNED_VERSION,
  buildOpenCodeReleaseAsset,
  isSupportedOpenCodeVersion,
} from './release'

export const OPENCODE_SERVER_USERNAME = 'opencode'

export type OpenCodeApi = ReturnType<typeof OpenCode.make>

export interface OpenCodeApiOptions {
  baseUrl: string
  password?: string
  fetch?: typeof fetch
  headers?: Record<string, string>
}

export function buildOpenCodeBasicAuth(password: string): string {
  const bytes = new TextEncoder().encode(`${OPENCODE_SERVER_USERNAME}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

export function createOpenCodeApi(options: OpenCodeApiOptions): OpenCodeApi {
  return OpenCode.make({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    headers: {
      ...options.headers,
      ...(options.password ? { Authorization: buildOpenCodeBasicAuth(options.password) } : {}),
    },
  })
}

export function openCodeLocation(directory: string): { location: { directory: string } } {
  return { location: { directory } }
}

const OPENCODE_ERROR_STATUS_BY_TAG: Record<string, number> = {
  InvalidRequestError: 400,
  RpcError: 400,
  InvalidCursorError: 400,
  FormInvalidAnswerError: 400,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  ProviderNotFoundError: 404,
  IntegrationNotFoundError: 404,
  IntegrationAttemptNotFoundError: 404,
  IntegrationMethodNotFoundError: 404,
  ProjectNotFoundError: 404,
  FileNotFoundError: 404,
  AgentNotFoundError: 404,
  SessionNotFoundError: 404,
  MessageNotFoundError: 404,
  SkillNotFoundError: 404,
  McpServerNotFoundError: 404,
  CommandNotFoundError: 404,
  PermissionNotFoundError: 404,
  FormNotFoundError: 404,
  PtyNotFoundError: 404,
  ShellNotFoundError: 404,
  ConflictError: 409,
  SessionBusyError: 409,
  FormAlreadySettledError: 409,
  InstructionEntryValueTooLargeError: 413,
  CommandExecutionError: 500,
  RpcInternalError: 500,
  UnknownError: 500,
  ServiceUnavailableError: 503,
}

export function openCodeErrorStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined

  const tag = (error as { _tag?: unknown })._tag
  if (typeof tag === 'string' && OPENCODE_ERROR_STATUS_BY_TAG[tag] !== undefined) {
    return OPENCODE_ERROR_STATUS_BY_TAG[tag]
  }

  const name = (error as { name?: unknown }).name
  if (typeof name === 'string') return OPENCODE_ERROR_STATUS_BY_TAG[name]

  return undefined
}
