import { OpenCode } from '@opencode/client'

export type {
  AgentInfo,
  CommandInfo,
  ConfigEntry,
  FileDiffInfo,
  FormAnswer,
  FormExternalField,
  FormField,
  FormInfo,
  FormValue,
  FormWhen,
  IntegrationInfo,
  IntegrationKeyMethod,
  IntegrationMethod,
  IntegrationOAuthMethod,
  McpServer,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  PromptAgentAttachment,
  PromptFileAttachment,
  PromptMention,
  PromptSkillAttachment,
  SessionInfo,
  SessionInboxCompaction,
  SessionInboxInfo,
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
  SkillInfo,
  V2Event,
} from '@opencode/client'

export { ClientError, isIntegrationNotFoundError, isMcpServerNotFoundError, isWorktreeError } from '@opencode/client'

export { assistantText, sessionIDFromEvent, toolContentText } from './content'

export type { AssistantTextOptions, ToolContentTextOptions } from './content'

export {
  MCP_OAUTH_CALLBACK_PATH,
  mcpOAuthRedirectUri,
  mcpServersFromConfig,
  mcpStatusByName,
} from './mcp'

export type {
  McpServerConfig,
  McpStatus,
  McpStatusMap,
  McpTimeoutConfig,
} from './mcp'

export {
  OPENCODE_PINNED_VERSION,
  OPENCODE_SUPPORTED_VERSION_RANGE,
  buildOpenCodeReleaseAsset,
  compareOpenCodeVersions,
  describeUnsupportedOpenCodeVersion,
  isStableOpenCodeVersion,
  isSupportedOpenCodeVersion,
  normalizeOpenCodeVersion,
  parseOpenCodeVersion,
  parseOpenCodeVersionOutput,
} from './release'

export type { OpenCodeVersion } from './release'

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

export interface OpenCodeLocation {
  location: { directory: string }
}

export function openCodeLocation(directory: string | undefined): OpenCodeLocation | undefined {
  return directory ? { location: { directory } } : undefined
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
