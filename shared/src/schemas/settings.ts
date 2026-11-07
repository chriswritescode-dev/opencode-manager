import { z } from "zod";
import { NotificationPreferencesSchema, DEFAULT_NOTIFICATION_PREFERENCES } from "./notifications";
import { OPENCODE_CONFIG_SOURCE_NAMES } from "../config/defaults";
import { ColorThemeIdSchema, MANAGER_COLOR_THEME_ID } from "../themes";
import { SessionPermissionModeSchema } from "./session-permissions";
import { SessionSandboxResourcesSchema } from "./session-sandbox";

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

export const DEFAULT_LEADER_KEY = 'Ctrl+X';

export const ACTIVITY_WINDOW_MINUTE_OPTIONS = [15, 30, 60, 120, 240, 480, 1440] as const;

export const ActivityWindowMinutesSchema = z.literal(ACTIVITY_WINDOW_MINUTE_OPTIONS);

export type ActivityWindowMinutes = z.infer<typeof ActivityWindowMinutesSchema>;

export const DEFAULT_ACTIVITY_WINDOW_MINUTES: ActivityWindowMinutes = 30;

export function isActivityWindowMinutes(value: unknown): value is ActivityWindowMinutes {
  return ActivityWindowMinutesSchema.safeParse(value).success;
}

export const DEFAULT_KEYBOARD_SHORTCUTS = {
  submit: 'Cmd+Enter',
  abort: 'Escape',
  clearPrompt: '',
  toggleMode: 'Shift+Tab',
  undo: 'U',
  redo: 'R',
  compact: 'C',
  fork: '',
  settings: '',
  sessions: 'L',
  switchPickerTab: 'Ctrl+S',
  newSession: 'N',
  closeSession: 'W',
  toggleSidebar: 'B',
  selectModel: 'M',
  variantCycle: 'Ctrl+T',
  favoriteCycle: 'Ctrl+R',
  toggleTerminal: 'T',
  toggleSourceControl: '',
  timeline: 'G',
  exportSession: 'X',
  halfPageUp: 'Ctrl+U',
  halfPageDown: 'Ctrl+D',
  speakVisible: 'S',
} satisfies Record<string, string>;

export type KeyboardShortcutAction = keyof typeof DEFAULT_KEYBOARD_SHORTCUTS;

export const DEFAULT_DIRECT_SHORTCUTS = ['submit', 'abort', 'clearPrompt', 'toggleMode', 'variantCycle', 'favoriteCycle', 'halfPageUp', 'halfPageDown', 'switchPickerTab'];

export const GitCredentialSchema = z.object({
  id: z.string().optional(),
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

const GIT_IDENTITY_EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+$/;

export function isValidGitIdentityEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed === "" || GIT_IDENTITY_EMAIL_PATTERN.test(trimmed);
}

export const GitIdentitySchema = z.object({
  name: z.string(),
  email: z.string(),
});

export type GitIdentity = z.infer<typeof GitIdentitySchema>;

export const GitIdentityProfileSchema = GitIdentitySchema.extend({
  id: z.string().min(1),
});

export type GitIdentityProfile = z.infer<typeof GitIdentityProfileSchema>;

export const ServerEnvVarSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

type ServerEnvVar = z.infer<typeof ServerEnvVarSchema>

export const BLOCKED_SERVER_ENV_KEYS = [
  'OPENCODE_PASSWORD',
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_CONFIG_CONTENT',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CONFIG_HOME',
  'TMPDIR',
] as const;

export const DEFAULT_GIT_IDENTITY: GitIdentity = {
  name: 'OpenCode Agent',
  email: '',
};

export const DEFAULT_SANDBOX_IDLE_STOP_MINUTES = 30;
export const DEFAULT_SANDBOX_MAX_RUNNING_VMS = 4;

export const SandboxPreferencesSchema = z.object({
  enabled: z.boolean(),
  gitCredentials: z.boolean().optional(),
  defaultForNewSessions: z.boolean().optional(),
  cpus: SessionSandboxResourcesSchema.shape.cpus.optional(),
  memoryMib: SessionSandboxResourcesSchema.shape.memoryMib.optional(),
  idleStopMinutes: z.number().int().min(1).max(1440).optional(),
  maxRunningVms: z.number().int().min(1).max(32).optional(),
});

export type SandboxPreferences = z.infer<typeof SandboxPreferencesSchema>;

export const DEFAULT_SANDBOX_PREFERENCES: SandboxPreferences = {
  enabled: false,
  gitCredentials: false,
  defaultForNewSessions: true,
  idleStopMinutes: DEFAULT_SANDBOX_IDLE_STOP_MINUTES,
  maxRunningVms: DEFAULT_SANDBOX_MAX_RUNNING_VMS,
};

export const SessionDefaultsSchema = z.object({
  permissionMode: SessionPermissionModeSchema,
});

export type SessionDefaults = z.infer<typeof SessionDefaultsSchema>;

export const DEFAULT_SESSION_DEFAULTS = {
  permissionMode: 'ask',
} satisfies SessionDefaults;

export const DevicePairingPreferencesSchema = z.object({
  allowPrivateNetworkHttp: z.boolean().optional(),
});

export type DevicePairingPreferences = z.infer<typeof DevicePairingPreferencesSchema>;

export const UserPreferencesSchema = z.object({
  theme: z.enum(["dark", "light", "system"]),
  colorTheme: ColorThemeIdSchema.optional(),
  mode: z.enum(["plan", "build"]),
  defaultModel: z.string().optional(),
  outputModel: z.string().optional(),
  /** Legacy field, read as a fallback for outputModel; never written by new clients. */
  walkthroughModel: z.string().optional(),
  activityWindowMinutes: ActivityWindowMinutesSchema.optional(),
  defaultAgent: z.string().optional(),
  autoScroll: z.boolean(),
  expandDiffs: z.boolean(),
  expandToolCalls: z.boolean(),
  groupToolCalls: z.boolean(),
  showReasoning: z.boolean(),
  simpleChatMode: z.boolean(),
  leaderKey: z.string().optional(),
  directShortcuts: z.array(z.string()).optional(),
  keyboardShortcuts: z.record(z.string(), z.string()),
  customCommands: z.array(CustomCommandSchema),
  gitCredentials: z.array(GitCredentialSchema).optional(),
  defaultGitCredentialId: z.string().optional(),
  gitIdentity: GitIdentitySchema.optional(),
  gitIdentities: z.array(GitIdentityProfileSchema).optional(),
  tts: TTSConfigSchema.optional(),
  stt: STTConfigSchema.optional(),
  notifications: NotificationPreferencesSchema.optional(),
  lastKnownGoodConfig: z.string().optional(),
  repoOrder: z.array(z.number()).optional(),
  repoSortMode: z.enum(['recent', 'manual', 'name']).optional(),
  serverEnvVars: z.array(ServerEnvVarSchema).optional(),
  sandbox: SandboxPreferencesSchema.optional(),
  sessionDefaults: SessionDefaultsSchema.optional(),
  devicePairing: DevicePairingPreferencesSchema.optional(),
  disabledDefaultServerEnvVars: z.array(z.string()).optional(),
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
  colorTheme: MANAGER_COLOR_THEME_ID,
  mode: "build" as const,
  activityWindowMinutes: DEFAULT_ACTIVITY_WINDOW_MINUTES,
  autoScroll: true,
  expandDiffs: true,
  expandToolCalls: false,
  groupToolCalls: true,
  showReasoning: false,
  simpleChatMode: false,
  keyboardShortcuts: {} as Record<string, string>,
  customCommands: [],
  customAgents: [],
  gitCredentials: [] as GitCredential[],
  defaultGitCredentialId: undefined as string | undefined,
  gitIdentity: DEFAULT_GIT_IDENTITY,
  tts: DEFAULT_TTS_CONFIG,
  stt: DEFAULT_STT_CONFIG,
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  repoSortMode: 'recent' as const,
  serverEnvVars: [] as ServerEnvVar[],
  sandbox: DEFAULT_SANDBOX_PREFERENCES,
  sessionDefaults: DEFAULT_SESSION_DEFAULTS,
};

export const SettingsResponseSchema = z.object({
  preferences: UserPreferencesSchema,
  updatedAt: z.number(),
});

export const UpdateSettingsRequestSchema = z.object({
  preferences: UserPreferencesSchema.partial(),
});

export const OpenCodeConfigValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const OpenCodeConfigSourceNameSchema = z.enum(OPENCODE_CONFIG_SOURCE_NAMES);

export const OpenCodeConfigSourceFileSchema = z.object({
  name: OpenCodeConfigSourceNameSchema,
  path: z.string(),
  rawContent: z.string(),
  content: z.record(z.string(), z.unknown()),
  isValid: z.boolean(),
  validationIssues: z.array(OpenCodeConfigValidationIssueSchema).optional(),
  updatedAt: z.number(),
});

export const OpenCodeConfigFileSchema = z.object({
  path: z.string(),
  content: z.record(z.string(), z.unknown()),
  rawContent: z.string(),
  isValid: z.boolean(),
  validationIssues: z.array(OpenCodeConfigValidationIssueSchema).optional(),
  updatedAt: z.number(),
  sources: z.array(OpenCodeConfigSourceFileSchema),
  revision: z.string(),
});

export const UpdateOpenCodeConfigRequestSchema = z.object({
  content: z.union([z.record(z.string(), z.unknown()), z.string()]),
  source: OpenCodeConfigSourceNameSchema.optional(),
  expectedRevision: z.string().optional(),
});

export const UpdateOpenCodeConfigPatchRequestSchema = z.object({
  patch: z.record(z.string(), z.unknown()),
  source: OpenCodeConfigSourceNameSchema.optional(),
  expectedRevision: z.string().optional(),
});

