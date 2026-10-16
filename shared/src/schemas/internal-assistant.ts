import { z } from 'zod'
import { UserPreferencesSchema } from './settings'

export const MANAGER_TOOL_NAME = 'ocm'

export const MANAGER_PROMPT_CLIENT_METADATA_KEY = 'ocmClient'

export const MANAGER_PROMPT_CLIENTS = ['mobile', 'desktop'] as const

export type ManagerPromptClient = (typeof MANAGER_PROMPT_CLIENTS)[number]

export const MANAGER_TOOL_OPEN_WALKTHROUGH_ACTION = 'open_walkthrough'

export const MANAGER_TOOL_SHOW_ARTIFACT_ACTION = 'show_artifact'

export const MANAGER_TOOL_ACTIONS = [
  'send_notification',
  'request',
  MANAGER_TOOL_OPEN_WALKTHROUGH_ACTION,
  MANAGER_TOOL_SHOW_ARTIFACT_ACTION,
] as const

export const ARTIFACT_LIMITS = {
  TITLE_MAX: 120,
  FILE_MAX_BYTES: 5 * 1024 * 1024,
} as const

export const ShowArtifactParamsSchema = z
  .object({
    title: z.string().min(1).max(ARTIFACT_LIMITS.TITLE_MAX).describe('A short title shown above the artifact.'),
    path: z
      .string()
      .min(1)
      .max(1000)
      .describe(
        'Path of a self-contained .html file the agent wrote, relative to the session directory or absolute inside it. Inline your own CSS and JavaScript; libraries may load from public CDNs.',
      ),
  })
  .strict()

export type ShowArtifactParams = z.infer<typeof ShowArtifactParamsSchema>

export const AssistantNotificationPrioritySchema = z.enum(['normal', 'high'])

export const ASSISTANT_NOTIFICATION_LIMITS = {
  TITLE_MAX: 120,
  BODY_MAX: 500,
  URL_MAX: 500,
  TAG_MAX: 80,
} as const

export const AssistantNotificationRequestSchema = z.object({
  title: z.string().min(1).max(ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX),
  body: z.string().min(1).max(ASSISTANT_NOTIFICATION_LIMITS.BODY_MAX),
  url: z.string().min(1).max(ASSISTANT_NOTIFICATION_LIMITS.URL_MAX).optional(),
  tag: z.string().max(ASSISTANT_NOTIFICATION_LIMITS.TAG_MAX).optional(),
  priority: AssistantNotificationPrioritySchema.default('normal'),
  sessionId: z.string().min(1).optional(),
})

export const AssistantNotificationResponseSchema = z.object({
  delivered: z.number(),
  expired: z.number(),
  failed: z.number(),
  noSubscriptions: z.boolean(),
})

// NOTE: These are defined as plain z.object (not .pick() from the full schemas)
// so that .default() values from the source schemas are NOT inherited. A patch
// like { voice: 'nova' } must produce only { voice: 'nova' } in the parsed output,
// not { voice: 'nova', provider: 'external', autoPlay: false }.
export const AssistantTTSPatchSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['external', 'builtin']),
  autoPlay: z.boolean(),
  voice: z.string(),
  model: z.string(),
  speed: z.number().min(0.25).max(4.0),
}).partial().strict()

export const AssistantSTTPatchSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['external', 'builtin']),
  model: z.string(),
  language: z.string(),
}).partial().strict()

export const AssistantSettingsPatchSchema = UserPreferencesSchema.pick({
  theme: true,
  colorTheme: true,
  mode: true,
  defaultModel: true,
  walkthroughModel: true,
  activityWindowMinutes: true,
  defaultAgent: true,
  autoScroll: true,
  expandDiffs: true,
  expandToolCalls: true,
  groupToolCalls: true,
  showReasoning: true,
  simpleChatMode: true,
  leaderKey: true,
  directShortcuts: true,
  keyboardShortcuts: true,
  customCommands: true,
  notifications: true,
  repoOrder: true,
  repoSortMode: true,
}).extend({
  tts: AssistantTTSPatchSchema,
  stt: AssistantSTTPatchSchema,
}).partial().strict()
