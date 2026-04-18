import { z } from "zod";
import { NotificationPreferencesSchema, DEFAULT_NOTIFICATION_PREFERENCES } from "./notifications";

export const CustomCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  promptTemplate: z.string(),
});

export const TTSConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['external', 'builtin']).default('external'),
  autoPlay: z.boolean().default(false),
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

export const STTConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['external', 'builtin']).default('builtin'),
  endpoint: z.string(),
  apiKey: z.string(),
  model: z.string(),
  language: z.string().default('en-US'),
  availableModels: z.array(z.string()).optional(),
  lastModelsFetch: z.number().optional(),
});

export type TTSConfig = {
  enabled: boolean;
  provider: 'external' | 'builtin';
  autoPlay: boolean;
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

export type STTConfig = {
  enabled: boolean;
  provider: 'external' | 'builtin';
  endpoint: string;
  apiKey: string;
  model: string;
  language: string;
  availableModels?: string[];
  lastModelsFetch?: number;
};

const isBrowser = typeof navigator !== 'undefined';
const isMac = isBrowser && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const CMD_KEY = isMac ? 'Cmd' : 'Ctrl';

export const DEFAULT_LEADER_KEY = `${CMD_KEY}+O`;

export const DEFAULT_KEYBOARD_SHORTCUTS: Record<string, string> = {
  submit: `${CMD_KEY}+Enter`,
  abort: 'Escape',
  toggleMode: 'T',
  undo: 'Z',
  redo: 'Shift+Z',
  compact: 'K',
  fork: 'F',
  settings: ',',
  sessions: 'S',
  newSession: 'N',
  closeSession: 'W',
  toggleSidebar: 'B',
  selectModel: 'M',
  variantCycle: `${CMD_KEY}+T`,
};

export const GitCredentialSchema = z.object({
  name: z.string(),
  host: z.string(),
  type: z.enum(['pat', 'ssh']).default('pat'),
  token: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  sshPrivateKeyEncrypted: z.string().optional(),
  hasPassphrase: z.boolean().optional(),
  username: z.string().optional(),
  passphrase: z.string().optional(),
});

export type GitCredential = z.infer<typeof GitCredentialSchema>;

export const GitIdentitySchema = z.object({
  name: z.string(),
  email: z.string(),
});

export type GitIdentity = z.infer<typeof GitIdentitySchema>;

export const DEFAULT_GIT_IDENTITY: GitIdentity = {
  name: 'OpenCode Agent',
  email: '',
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
  leaderKey: z.string().optional(),
  directShortcuts: z.array(z.string()).optional(),
  keyboardShortcuts: z.record(z.string(), z.string()),
  customCommands: z.array(CustomCommandSchema),
  gitCredentials: z.array(GitCredentialSchema).optional(),
  gitIdentity: GitIdentitySchema.optional(),
  tts: TTSConfigSchema.optional(),
  stt: STTConfigSchema.optional(),
  notifications: NotificationPreferencesSchema.optional(),
  lastKnownGoodConfig: z.string().optional(),
  repoOrder: z.array(z.number()).optional(),
  repoSortMode: z.enum(['recent', 'manual', 'name']).optional(),
});

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: false,
  provider: 'external',
  autoPlay: false,
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

export const DEFAULT_STT_CONFIG: STTConfig = {
  enabled: false,
  provider: 'builtin',
  endpoint: "https://api.openai.com",
  apiKey: "",
  model: '',
  language: 'en-US',
  availableModels: [],
  lastModelsFetch: 0,
};

export const DEFAULT_USER_PREFERENCES = {
  theme: "dark" as const,
  mode: "build" as const,
  autoScroll: true,
  showReasoning: false,
  expandToolCalls: false,
  expandDiffs: true,
  leaderKey: DEFAULT_LEADER_KEY,
  directShortcuts: ['submit', 'abort'],
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  customCommands: [],
  customAgents: [],
  gitCredentials: [] as GitCredential[],
  gitIdentity: DEFAULT_GIT_IDENTITY,
  tts: DEFAULT_TTS_CONFIG,
  stt: DEFAULT_STT_CONFIG,
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  repoSortMode: 'recent' as const,
};

export const SettingsResponseSchema = z.object({
  preferences: UserPreferencesSchema,
  updatedAt: z.number(),
});

export const UpdateSettingsRequestSchema = z.object({
  preferences: UserPreferencesSchema.partial(),
});

export const ProviderApiConfigSchema = z.object({
  url: z.string(),
  npm: z.string().optional(),
});

export type ProviderApiConfig = z.infer<typeof ProviderApiConfigSchema>;

export const ModelCapabilitiesSchema = z.object({
  temperature: z.boolean(),
  reasoning: z.boolean(),
  attachment: z.boolean(),
  toolcall: z.boolean(),
  input: z.object({
    text: z.boolean(),
    audio: z.boolean(),
    image: z.boolean(),
    video: z.boolean(),
    pdf: z.boolean(),
  }),
  output: z.object({
    text: z.boolean(),
    audio: z.boolean(),
    image: z.boolean(),
    video: z.boolean(),
    pdf: z.boolean(),
  }),
  interleaved: z.union([
    z.boolean(),
    z.object({
      field: z.enum(["reasoning_content", "reasoning_details"]),
    }),
  ]),
});

export const ModelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cache: z.object({
    read: z.number(),
    write: z.number(),
  }).optional(),
  experimentalOver200K: z.object({
    input: z.number(),
    output: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }).optional(),
  }).optional(),
});

export const ModelLimitSchema = z.object({
  context: z.number(),
  input: z.number().optional(),
  output: z.number(),
});

export const ModelConfigSchema = z.object({
  id: z.string().optional(),
  providerID: z.string().optional(),
  api: ProviderApiConfigSchema.optional(),
  name: z.string().optional(),
  family: z.string().optional(),
  capabilities: ModelCapabilitiesSchema.optional(),
  cost: ModelCostSchema.optional(),
  limit: ModelLimitSchema.optional(),
  status: z.enum(["alpha", "beta", "deprecated", "active"]).optional(),
  options: z.record(z.string(), z.any()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  release_date: z.string().optional(),
  variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ProviderSourceSchema = z.enum(["env", "config", "custom", "api"]);

export const ProviderConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  source: ProviderSourceSchema.optional(),
  env: z.array(z.string()).optional().default([]),
  key: z.string().optional(),
  options: z.record(z.string(), z.any()).optional(),
  models: z.record(z.string(), ModelConfigSchema).optional(),
});

export type ProviderSource = z.infer<typeof ProviderSourceSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const OpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  theme: z.string().optional(),
  model: z.string().optional(),
  small_model: z.string().optional(),
  provider: z.record(z.string(), ProviderConfigSchema).optional(),
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
  plugin: z.array(z.string()).optional(),
  skills: z.object({
    paths: z.array(z.string()).optional(),
    urls: z.array(z.string()).optional(),
  }).optional(),
}).strip();

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
