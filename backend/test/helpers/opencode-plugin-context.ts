import { pathToFileURL } from 'url'
import { z } from 'zod'
import type { JsonValue } from '@opencode-manager/shared/utils'
import { SANDBOX_SHELL_STATE_KEY } from '../../src/services/opencode-plugin-state'

export type ShellCreateBeforeEvent = {
  command?: string
  cwd: string
  timeout?: number
  shell?: string
  env: Record<string, string | undefined>
}

export type ToolMetadata = {
  sandbox?: JsonValue
  sandboxProvider?: JsonValue
  path?: JsonValue
  [key: string]: JsonValue | undefined
}

export type ToolResult = {
  output?: JsonValue
  content?: JsonValue
  metadata?: ToolMetadata
  [key: string]: JsonValue | ToolMetadata | undefined
}

export type ToolExecuteAfterEvent = {
  tool: string
  status: 'completed' | 'error'
  result?: ToolResult
  error?: JsonValue
  id?: string
  input?: JsonValue
}

export type GeneratedToolExecuteContext = {
  signal: AbortSignal
  sessionID?: string
  id?: string
}

export type GeneratedTool = {
  name: string
  description?: string
  input?: JsonValue
  execute?: (input: JsonValue, context: GeneratedToolExecuteContext) => Promise<JsonValue>
}

export type PermissionEvaluateEvent = {
  action: string
  resources?: ReadonlyArray<JsonValue | undefined>
  metadata?: ToolMetadata
  effect?: string
  message?: string
}

export type SessionPromptEvent = {
  sessionID: string
  prompt?: JsonValue
  metadata?: ToolMetadata
}

export type SessionContextEvent = {
  sessionID: string
  agent?: JsonValue
  model?: JsonValue
  system?: Array<{ type: string; text: string }>
  messages?: JsonValue
  tools?: Record<string, { description: string; input?: JsonValue }>
  options?: JsonValue
}

export type GeneratedPlugin = {
  id: string
  triggerShellCreateBefore: (event: ShellCreateBeforeEvent) => Promise<void>
  triggerToolExecuteAfter: (event: ToolExecuteAfterEvent) => Promise<void>
  triggerPermissionEvaluate: (event: PermissionEvaluateEvent) => Promise<void>
  triggerSessionPrompt: (event: SessionPromptEvent) => Promise<void>
  triggerSessionContext: (event: SessionContextEvent) => Promise<void>
  applyToolTransforms: (seed: GeneratedTool[]) => GeneratedTool[]
  registeredTools: () => GeneratedTool[]
  dispose: () => Promise<void>
}

export type LoadGeneratedPluginOptions = {
  location?: { directory: string }
}

type ShellHookCallback = (event: ShellCreateBeforeEvent) => Promise<void> | void
type ToolHookCallback = (event: ToolExecuteAfterEvent) => Promise<void> | void
type PermissionHookCallback = (event: PermissionEvaluateEvent) => Promise<void> | void
type SessionPromptHookCallback = (event: SessionPromptEvent) => Promise<void> | void
type SessionContextHookCallback = (event: SessionContextEvent) => Promise<void> | void
type SessionHookCallback = SessionPromptHookCallback | SessionContextHookCallback

type ToolEditor = {
  list: () => GeneratedTool[]
  get: (id: string) => GeneratedTool | undefined
  add: (tool: GeneratedTool) => void
  update: (id: string, update: (tool: GeneratedTool) => void) => void
  remove: (id: string) => void
  namespace: () => void
}

type ToolTransformCallback = (editor: ToolEditor) => void

type Registration = { dispose: () => Promise<void> }

type PluginContext = {
  location: { directory: string }
  shell: {
    hook: (name: string, callback: ShellHookCallback) => Promise<Registration>
  }
  tool: {
    hook: (name: string, callback: ToolHookCallback) => Promise<Registration>
    transform: (callback: ToolTransformCallback) => Promise<Registration>
  }
  permission: {
    hook: (name: string, callback: PermissionHookCallback) => Promise<Registration>
  }
  session: {
    hook: (name: string, callback: SessionHookCallback) => Promise<Registration>
  }
}

type PluginCleanup = () => Promise<void> | void

type PluginSetup = (context: PluginContext) => PluginCleanup | void | Promise<PluginCleanup | void>

function createRegistry<Event>(name: string) {
  const callbacks: Array<(event: Event) => Promise<void> | void> = []
  return {
    register(callback: (event: Event) => Promise<void> | void): Registration {
      callbacks.push(callback)
      return { dispose: async () => undefined }
    },
    async trigger(event: Event): Promise<void> {
      if (callbacks.length === 0) throw new Error(`the generated plugin registered no ${name} hook`)
      for (const callback of callbacks) await callback(event)
    },
  }
}

function createPluginContext(location: { directory: string }) {
  const shellCreateBefore = createRegistry<ShellCreateBeforeEvent>('create.before')
  const toolExecuteAfter = createRegistry<ToolExecuteAfterEvent>('execute.after')
  const permissionEvaluate = createRegistry<PermissionEvaluateEvent>('evaluate')
  const sessionPrompt = createRegistry<SessionPromptEvent>('prompt')
  const sessionContext = createRegistry<SessionContextEvent>('context')
  const transforms: ToolTransformCallback[] = []

  const context: PluginContext = {
    location,
    shell: {
      hook: async (name, callback) => {
        if (name !== 'create.before') throw new Error(`unexpected shell hook ${name}`)
        return shellCreateBefore.register(callback)
      },
    },
    tool: {
      hook: async (name, callback) => {
        if (name !== 'execute.after') throw new Error(`unexpected tool hook ${name}`)
        return toolExecuteAfter.register(callback)
      },
      transform: async (callback) => {
        transforms.push(callback)
        return { dispose: async () => undefined }
      },
    },
    permission: {
      hook: async (name, callback) => {
        if (name !== 'evaluate') throw new Error(`unexpected permission hook ${name}`)
        return permissionEvaluate.register(callback)
      },
    },
    session: {
      hook: async (name, callback) => {
        if (name === 'prompt') return sessionPrompt.register(callback)
        if (name === 'context') return sessionContext.register(callback)
        throw new Error(`unexpected session hook ${name}`)
      },
    },
  }

  const applyToolTransforms = (seed: GeneratedTool[]): GeneratedTool[] => {
    const byName = new Map<string, GeneratedTool>()
    for (const tool of seed) byName.set(tool.name, tool)
    const editor: ToolEditor = {
      list: () => [...byName.values()],
      get: (id) => byName.get(id),
      add: (tool) => {
        byName.set(tool.name, tool)
      },
      update: (id, update) => {
        const tool = byName.get(id)
        if (tool) update(tool)
      },
      remove: (id) => {
        byName.delete(id)
      },
      namespace: () => undefined,
    }
    for (const transform of transforms) transform(editor)
    return [...byName.values()]
  }

  return {
    context,
    triggerShellCreateBefore: (event: ShellCreateBeforeEvent) => shellCreateBefore.trigger(event),
    triggerToolExecuteAfter: (event: ToolExecuteAfterEvent) => toolExecuteAfter.trigger(event),
    triggerPermissionEvaluate: (event: PermissionEvaluateEvent) => permissionEvaluate.trigger(event),
    triggerSessionPrompt: (event: SessionPromptEvent) => sessionPrompt.trigger(event),
    triggerSessionContext: (event: SessionContextEvent) => sessionContext.trigger(event),
    applyToolTransforms,
    registeredTools: () => applyToolTransforms([]),
  }
}

const ImportedPluginModuleSchema = z.object({
  default: z.unknown(),
})

const PluginDefinitionSchema = z.object({
  id: z.string().min(1),
  setup: z.custom<PluginSetup>((value) => z.function().safeParse(value).success),
})

const PluginCleanupSchema = z.function().optional()

export const SECRET_MASK_STATE_KEY = 'ocm-secret-masks.v1'

export interface SecretMaskState {
  byCwd: Map<string, string[]>
  version: number
  unionVersion: number
  union: string[]
}

export interface SandboxShellPendingMarker {
  callID: string
  sessionID?: string
}

export interface SandboxShellState {
  pendingMarkers: Map<string, SandboxShellPendingMarker>
  sandboxedCallIDs: Set<string>
  foreignOwners: Map<string, string>
  inFlightSandboxedCommands: Map<string, number>
}

export interface SandboxClaimRequest {
  sessionID?: string
  directory?: string
}

export interface SandboxClaim {
  tier: string
  since: number
}

export interface SandboxArbiterProvider {
  id: string
  claim: (request: SandboxClaimRequest) => Promise<SandboxClaim | null>
}

export interface SandboxArbiterDecision {
  owner: string | null
}

export interface SandboxArbiterRegistry {
  version: number
  providers: Map<string, SandboxArbiterProvider>
  decisions: Map<string, Promise<SandboxArbiterDecision>>
}

export const SANDBOX_ARBITER_STATE_KEY = 'opencode.sandbox-arbiter.v1'

const SecretMaskStateSchema = z.object({
  byCwd: z.map(z.string(), z.array(z.string())),
  version: z.number(),
  unionVersion: z.number(),
  union: z.array(z.string()),
})

const SandboxShellPendingMarkerSchema = z.object({
  callID: z.string(),
  sessionID: z.string().optional(),
})

const SandboxShellStateSchema = z.object({
  pendingMarkers: z.map(z.string(), SandboxShellPendingMarkerSchema),
  sandboxedCallIDs: z.set(z.string()),
  foreignOwners: z.map(z.string(), z.string()),
  inFlightSandboxedCommands: z.map(z.string(), z.number()),
})

const SandboxArbiterRegistrySchema = z.custom<SandboxArbiterRegistry>((value) => {
  if (!(value instanceof Object)) return false
  if (!('version' in value) || !Number.isFinite(value.version)) return false
  if (!('providers' in value) || !(value.providers instanceof Map)) return false
  return 'decisions' in value && value.decisions instanceof Map
})

function readPluginGlobalState<S extends z.ZodType>(key: string, schema: S): z.infer<S> | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(key))
  const parsed = schema.safeParse(descriptor?.value)
  return parsed.success ? parsed.data : undefined
}

export function readSecretMaskState(): SecretMaskState | undefined {
  return readPluginGlobalState(SECRET_MASK_STATE_KEY, SecretMaskStateSchema)
}

export function readSandboxShellState(): SandboxShellState | undefined {
  return readPluginGlobalState(SANDBOX_SHELL_STATE_KEY, SandboxShellStateSchema)
}

export function readSandboxArbiterRegistry(): SandboxArbiterRegistry | undefined {
  return readPluginGlobalState(SANDBOX_ARBITER_STATE_KEY, SandboxArbiterRegistrySchema)
}

export function resetPluginGlobalState(): void {
  Reflect.deleteProperty(globalThis, Symbol.for(SECRET_MASK_STATE_KEY))
  Reflect.deleteProperty(globalThis, Symbol.for(SANDBOX_SHELL_STATE_KEY))
  Reflect.deleteProperty(globalThis, Symbol.for(SANDBOX_ARBITER_STATE_KEY))
}

let importCount = 0

export async function loadGeneratedPlugin(file: string, options: LoadGeneratedPluginOptions = {}): Promise<GeneratedPlugin> {
  importCount += 1
  const imported = ImportedPluginModuleSchema.parse(await import(`${pathToFileURL(file).href}?ocm-test=${importCount}`))
  const parsedDefinition = PluginDefinitionSchema.safeParse(imported.default)
  if (!parsedDefinition.success) {
    throw new Error(`${file} must default-export a plugin definition object with an id and a setup function`)
  }
  const definition = parsedDefinition.data

  const registrations = createPluginContext({ directory: options.location?.directory ?? process.cwd() })
  const cleanup = PluginCleanupSchema.parse(await definition.setup(registrations.context))
  return {
    id: definition.id,
    triggerShellCreateBefore: registrations.triggerShellCreateBefore,
    triggerToolExecuteAfter: registrations.triggerToolExecuteAfter,
    triggerPermissionEvaluate: registrations.triggerPermissionEvaluate,
    triggerSessionPrompt: registrations.triggerSessionPrompt,
    triggerSessionContext: registrations.triggerSessionContext,
    applyToolTransforms: registrations.applyToolTransforms,
    registeredTools: registrations.registeredTools,
    dispose: async () => {
      if (cleanup) await cleanup()
    },
  }
}
