import { z } from "zod";

const ALLOWED_TTS_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'api.elevenlabs.io',
  'api.deepgram.com',
  'localhost',
  '127.0.0.1',
];

const isAllowedTTSEndpoint = (endpoint: string): boolean => {
  if (!endpoint) return true;
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    if (ALLOWED_TTS_HOSTS.includes(hostname)) return true;
    if (hostname.endsWith('.openai.com')) return true;
    if (hostname.endsWith('.anthropic.com')) return true;
    if (hostname.endsWith('.elevenlabs.io')) return true;
    if (hostname.endsWith('.deepgram.com')) return true;
    if (url.protocol !== 'https:' && !hostname.startsWith('localhost') && hostname !== '127.0.0.1') {
      return false;
    }
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^0\./,
    ];
    if (privateRanges.some(range => range.test(hostname))) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export const CustomCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  promptTemplate: z.string(),
});

export const TTSConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['external', 'builtin', 'chatterbox', 'coqui']).default('external'),
  endpoint: z.string().refine(isAllowedTTSEndpoint, {
    message: 'TTS endpoint must be a valid HTTPS URL from an allowed provider',
  }),
  apiKey: z.string(),
  voice: z.string(),
  model: z.string(),
  speed: z.number().min(0.25).max(4.0),
  availableVoices: z.array(z.string()).optional(),
  availableModels: z.array(z.string()).optional(),
  lastVoicesFetch: z.number().optional(),
  lastModelsFetch: z.number().optional(),
  chatterboxExaggeration: z.number().min(0).max(1).optional(),
  chatterboxCfgWeight: z.number().min(0).max(1).optional(),
  autoReadNewMessages: z.boolean().optional(),
});

export const STTConfigSchema = z.object({
  enabled: z.boolean(),
  model: z.string().default('base'),
  language: z.string().optional(),
  autoSubmit: z.boolean().default(false),
  availableModels: z.array(z.string()).optional(),
});

export const TalkModeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  silenceThresholdMs: z.number().min(300).max(2000).default(800),
  minSpeechMs: z.number().min(200).max(1000).default(400),
  autoInterrupt: z.boolean().default(true),
});

export const NotificationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  sessionComplete: z.boolean().default(true),
  permissionRequests: z.boolean().default(true),
  sound: z.boolean().default(false),
});

export const CustomAgentSchema = z.object({
  name: z.string(),
  description: z.string(),
  config: z.record(z.string(), z.any()),
});

export type TTSConfig = {
  enabled: boolean;
  provider: 'external' | 'builtin' | 'chatterbox' | 'coqui';
  endpoint: string;
  apiKey: string;
  voice: string;
  model: string;
  speed: number;
  availableVoices?: string[];
  availableModels?: string[];
  lastVoicesFetch?: number;
  lastModelsFetch?: number;
  chatterboxExaggeration?: number;
  chatterboxCfgWeight?: number;
  autoReadNewMessages?: boolean;
};

export type STTConfig = {
  enabled: boolean;
  model: string;
  language?: string;
  autoSubmit: boolean;
  availableModels?: string[];
};

export type TalkModeConfig = {
  enabled: boolean;
  silenceThresholdMs: number;
  minSpeechMs: number;
  autoInterrupt: boolean;
};

export type NotificationConfig = {
  enabled: boolean;
  sessionComplete: boolean;
  permissionRequests: boolean;
  sound: boolean;
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
  stt: STTConfigSchema.optional(),
  talkMode: TalkModeConfigSchema.optional(),
  notifications: NotificationConfigSchema.optional(),
  lastKnownGoodConfig: z.string().optional(),
});

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: false,
  provider: 'coqui',
  endpoint: "https://api.openai.com",
  apiKey: "",
  voice: "alloy",
  model: "tts-1",
  speed: 1.0,
  availableVoices: [],
  availableModels: [],
  lastVoicesFetch: 0,
  lastModelsFetch: 0,
  chatterboxExaggeration: 0.5,
  chatterboxCfgWeight: 0.5,
  autoReadNewMessages: false,
};

export const DEFAULT_STT_CONFIG: STTConfig = {
  enabled: false,
  model: 'base',
  language: undefined,
  autoSubmit: false,
  availableModels: ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3'],
};

export const DEFAULT_TALK_MODE_CONFIG: TalkModeConfig = {
  enabled: false,
  silenceThresholdMs: 800,
  minSpeechMs: 400,
  autoInterrupt: true,
};

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: false,
  sessionComplete: true,
  permissionRequests: true,
  sound: false,
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
  stt: DEFAULT_STT_CONFIG,
  talkMode: DEFAULT_TALK_MODE_CONFIG,
  notifications: DEFAULT_NOTIFICATION_CONFIG,
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
