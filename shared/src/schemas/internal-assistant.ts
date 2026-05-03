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
}).partial().strict()

export const ASSISTANT_SETTINGS_ALLOWED_KEYS = [
  'theme',
  'mode',
  'defaultModel',
  'defaultAgent',
  'autoScroll',
  'expandDiffs',
  'expandToolCalls',
  'showReasoning',
  'simpleChatMode',
  'leaderKey',
  'directShortcuts',
  'keyboardShortcuts',
  'customCommands',
  'notifications',
  'repoOrder',
  'repoSortMode',
] as const
