import { z } from 'zod'
import { UserPreferencesSchema } from './settings'

export const AssistantNotificationPrioritySchema = z.enum(['normal', 'high'])

export const AssistantNotificationRequestSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  url: z.string().min(1).max(500).optional(),
  tag: z.string().max(80).optional(),
  priority: AssistantNotificationPrioritySchema.default('normal'),
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
  mode: true,
  defaultModel: true,
  defaultAgent: true,
  autoScroll: true,
  expandDiffs: true,
  expandToolCalls: true,
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
