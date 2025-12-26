import { z } from "zod";

export const CustomCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  promptTemplate: z.string(),
});

export const TTSConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['external', 'builtin']).default('external'),
  endpoint: z.string(),
  apiKey: z.string(),
  voice: z.string(),
  model: z.string(),
  speed: z.number().min(0.25).max(4.0),
  availableVoices: z.array(z.string()).optional(),
  availableModels: z.array(z.string()).optional(),
  lastVoicesFetch: z.number().optional(),
  lastModelsFetch: z.number().optional(),
});

export const CustomAgentSchema = z.object({
  name: z.string(),
  description: z.string(),
  config: z.record(z.string(), z.any()),
});

export type TTSConfig = {
  enabled: boolean;
  provider: 'external' | 'builtin';
  endpoint: string;
  apiKey: string;
  voice: string;
  model: string;
  speed: number;
  availableVoices?: string[];
  availableModels?: string[];
  lastVoicesFetch?: number;
  lastModelsFetch?: number;
};

const isBrowser = typeof navigator !== 'undefined';
const isMac = isBrowser && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const CMD_KEY = isMac ? 'Cmd' : 'Ctrl';

export const DEFAULT_KEYBOARD_SHORTCUTS: Record<string, string> = {
  submit: `${CMD_KEY}+Enter`,
  abort: 'Escape',
  toggleMode: 'Tab',
  undo: `${CMD_KEY}+Z`,
  redo: `${CMD_KEY}+Shift+Z`,
  compact: `${CMD_KEY}+K`,
  fork: `${CMD_KEY}+Shift+F`,
  settings: `${CMD_KEY}+,`,
  sessions: `${CMD_KEY}+S`,
  newSession: `${CMD_KEY}+N`,
  closeSession: `${CMD_KEY}+W`,
  toggleSidebar: `${CMD_KEY}+B`,
  selectModel: `${CMD_KEY}+M`,
};

export const UserPreferencesSchema = z.object({
  theme: z.enum(["dark", "light", "system"]),
  mode: z.enum(["plan", "build"]),
  defaultModel: z.string().optional(),
  defaultAgent: z.string().optional(),
  autoScroll: z.boolean(),
  showReasoning: z.boolean(),
  expandToolCalls: z.boolean(),
  expandDiffs: z.boolean(),
  keyboardShortcuts: z.record(z.string(), z.string()),
  customCommands: z.array(CustomCommandSchema),
  customAgents: z.array(CustomAgentSchema),
  gitToken: z.string().optional(),
  tts: TTSConfigSchema.optional(),
});

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: false,
  provider: 'external',
  endpoint: "https://api.openai.com",
  apiKey: "",
  voice: "alloy",
  model: "tts-1",
  speed: 1.0,
  availableVoices: [],
  availableModels: [],
  lastVoicesFetch: 0,
  lastModelsFetch: 0,
};

export const DEFAULT_USER_PREFERENCES = {
  theme: "dark" as const,
  mode: "build" as const,
  autoScroll: true,
  showReasoning: false,
  expandToolCalls: false,
  expandDiffs: true,
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  customCommands: [],
  customAgents: [],
  gitToken: undefined,
  tts: DEFAULT_TTS_CONFIG,
};

export const SettingsResponseSchema = z.object({
  preferences: UserPreferencesSchema,
  updatedAt: z.number(),
});

export const UpdateSettingsRequestSchema = z.object({
  preferences: UserPreferencesSchema.partial(),
});

export const OpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  theme: z.string().optional(),
  model: z.string().optional(),
  small_model: z.string().optional(),
  provider: z.record(z.string(), z.any()).optional(),
  agent: z.record(z.string(), z.any()).optional(),
  command: z.record(z.string(), z.any()).optional(),
  keybinds: z.record(z.string(), z.any()).optional(),
  autoupdate: z.union([z.boolean(), z.literal("notify")]).optional(),
  formatter: z.record(z.string(), z.any()).optional(),
  permission: z.record(z.string(), z.any()).optional(),
  mcp: z.record(z.string(), z.any()).optional(),
  instructions: z.array(z.string()).optional(),
  disabled_providers: z.array(z.string()).optional(),
  share: z.enum(["manual", "auto", "disabled"]).optional(),
});

export type OpenCodeConfigContent = z.infer<typeof OpenCodeConfigSchema>;

export const OpenCodeConfigMetadataSchema = z.object({
  id: z.number(),
  name: z.string().min(1).max(255),
  content: OpenCodeConfigSchema,
  isDefault: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const CreateOpenCodeConfigRequestSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.union([OpenCodeConfigSchema, z.string()]),
  isDefault: z.boolean().optional(),
});

export const UpdateOpenCodeConfigRequestSchema = z.object({
  content: z.union([OpenCodeConfigSchema, z.string()]),
  isDefault: z.boolean().optional(),
});

export const OpenCodeConfigResponseSchema = z.object({
  configs: z.array(OpenCodeConfigMetadataSchema),
  defaultConfig: OpenCodeConfigMetadataSchema.nullable(),
});
