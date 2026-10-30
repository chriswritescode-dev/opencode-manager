import { OpenCode } from '@opencode/client'
import { OPENCODE_SERVER_USERNAME } from '../schemas/opencode-servers'

export { OPENCODE_SERVER_USERNAME }

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

export { ClientError, isIntegrationNotFoundError, isMcpServerNotFoundError, isSessionNotFoundError, isWorktreeError } from '@opencode/client'

export { assistantText, sessionIDFromEvent, toolContentText } from './content'

export {
  GOAL_CHANGED_EVENT_TYPE,
  GOAL_COMMAND_NAME,
  GOAL_RPC_ID,
  GOAL_USER_PAUSE_REASONS,
  goalChangeFromEvent,
  isGoalOpen,
  isGoalOutcome,
  readSessionGoal,
} from './goal'

export type { GoalState, GoalStatus, SessionGoalRead } from './goal'

export { configModelRef, formatOpenCodeModelRef, parseOpenCodeModelRef, selectConfiguredModelRef } from './modelRef'

export {
  addRecentModel,
  compareCatalogModels,
  cycleModelVariant,
  decodeModelPreference,
  favoriteModels,
  findModelInfo,
  isActiveCatalogProvider,
  isModelFree,
  isSameModelRef,
  isSameModelSelection,
  isSelectableCatalogModel,
  modelPreferenceKey,
  normalizeModelVariant,
  recentModels,
  removeRecentModel,
  selectEffectiveModelRef,
  selectInteractiveModel,
  selectPreferredVariant,
  setModelVariant,
  toModelPreference,
  toggleFavoriteModel,
} from './modelPreference'

export type { ModelPreference, ModelPreferenceDocument, ModelPreferenceModel } from './modelPreference'

export {
  MCP_OAUTH_CALLBACK_PATH,
  mcpOAuthRedirectUri,
  mcpServerViewsFromConfig,
  mcpServersFromConfig,
  mcpStatusByName,
} from './mcp'

export type {
  McpServerConfig,
  McpServerView,
  McpStatus,
  McpStatusMap,
  McpTimeoutConfig,
} from './mcp'

export {
  createOpenCodePairingNonce,
  createOpenCodePairingProof,
  decryptOpenCodePairingCredentials,
  encryptOpenCodePairingCredentials,
  isOpenCodePairingCredentials,
  isOpenCodePairingNonce,
  verifyOpenCodePairingProof,
} from './pairing'

export type {
  OpenCodePairingCredentials,
  OpenCodePairingDecryptOptions,
  OpenCodePairingEncryptedCredentials,
  OpenCodePairingKeyOptions,
} from './pairing'

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

export {
  DEFAULT_VOICE_PAUSE_MS,
  VOICE_NO_SPEECH_TIMEOUT_MS,
  VOICE_PAUSE_OPTIONS_MS,
  VOICE_PAUSE_STORAGE_KEY,
  formatVoicePauseMs,
  isVoicePauseOption,
  normalizeVoicePauseMs,
  parseVoicePauseMs,
} from './voicePauseSetting'

export {
  INITIAL_VOICE_CONVERSATION_STATE,
  VOICE_MODE_INSTRUCTIONS,
  VOICE_MODE_INSTRUCTION_KEY,
  findNextUnspokenMessage,
  hasIncompleteAssistant,
  hasSpokenMessage,
  isVoiceTurnComplete,
  listUnspokenMessages,
  reduceVoiceConversation,
  voiceConversationHint,
  voiceConversationLabel,
} from './voiceConversation'

export type {
  VoiceConversationEvent,
  VoiceConversationLabelInput,
  VoiceConversationState,
  VoiceFailureSource,
  VoicePauseReason,
  VoicePhase,
  VoiceSessionStatus,
  VoiceSpokenMessage,
  VoiceTurnCompletionInput,
} from './voiceConversation'

export { OPENCODE_LIFECYCLE_STATES, OPENCODE_RECOVERY_ACTIONS } from './lifecycle'

export type { OpenCodeLifecycleState, OpenCodeLifecycleStatus, OpenCodeRecoveryAction } from './lifecycle'

export type OpenCodeApi = ReturnType<typeof OpenCode.make>

export interface OpenCodeApiOptions {
  baseUrl: string
  password?: string
  fetch?: typeof fetch
  headers?: Record<string, string>
}

export function buildOpenCodeBasicAuth(password: string, username: string = OPENCODE_SERVER_USERNAME): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
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
