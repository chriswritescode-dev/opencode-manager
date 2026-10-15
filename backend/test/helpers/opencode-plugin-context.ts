import { pathToFileURL } from 'url'

export type ShellCreateBeforeEvent = {
  command?: string
  cwd: string
  timeout?: number
  shell?: string
  env: Record<string, string | undefined>
}

export type ToolResult = {
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type ToolExecuteAfterEvent = {
  tool: string
  status: 'completed' | 'error'
  result?: ToolResult
  error?: unknown
  id?: string
  [key: string]: unknown
}

export type GeneratedToolExecuteContext = {
  signal: AbortSignal
  sessionID?: string
  id?: string
  [key: string]: unknown
}

export type GeneratedTool = {
  name: string
  description?: string
  input?: unknown
  execute?: (input: unknown, context: GeneratedToolExecuteContext) => Promise<unknown>
  [key: string]: unknown
}

export type PermissionEvaluateEvent = {
  action: string
  resources?: ReadonlyArray<string>
  metadata?: Record<string, unknown>
  effect?: string
  message?: string
  [key: string]: unknown
}

export type SessionPromptEvent = {
  sessionID: string
  prompt?: unknown
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type SessionContextEvent = {
  sessionID: string
  agent?: unknown
  model?: unknown
  system?: Array<{ type: string; text: string; [key: string]: unknown }>
  messages?: unknown
  tools?: Record<string, { description: string; input?: unknown }>
  options?: unknown
  [key: string]: unknown
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

/** Creates a test plugin context with hook registries, event triggers, and tool transforms. */
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
      /** Registers prompt or context callbacks, rejecting unsupported session hook names. */
      hook: async (name, callback) => {
        if (name === 'prompt') return sessionPrompt.register(callback as SessionPromptHookCallback)
        if (name === 'context') return sessionContext.register(callback as SessionContextHookCallback)
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
    /** Dispatches a prompt event to the registered session callbacks. */
    triggerSessionPrompt: (event: SessionPromptEvent) => sessionPrompt.trigger(event),
    /** Dispatches a context event so registered callbacks can update it. */
    triggerSessionContext: (event: SessionContextEvent) => sessionContext.trigger(event),
    applyToolTransforms,
    registeredTools: () => applyToolTransforms([]),
  }
}

let importCount = 0

/** Imports a fresh plugin instance, validates its definition, and runs setup in the test context. */
export async function loadGeneratedPlugin(file: string, options: LoadGeneratedPluginOptions = {}): Promise<GeneratedPlugin> {
  importCount += 1
  const imported = (await import(`${pathToFileURL(file).href}?ocm-test=${importCount}`)) as { default?: unknown }
  const definition = imported.default
  if (definition === null || typeof definition !== 'object') {
    throw new Error(`${file} must default-export a plugin definition object`)
  }
  const id = (definition as { id?: unknown }).id
  const setup = (definition as { setup?: unknown }).setup
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`${file} must default-export a plugin id`)
  }
  if (typeof setup !== 'function') {
    throw new Error(`${file} must default-export a setup function`)
  }

  const registrations = createPluginContext({ directory: options.location?.directory ?? process.cwd() })
  const cleanup = (await (setup as (context: PluginContext) => Promise<PluginCleanup | void> | PluginCleanup | void)(registrations.context)) as PluginCleanup | void
  return {
    id,
    triggerShellCreateBefore: registrations.triggerShellCreateBefore,
    triggerToolExecuteAfter: registrations.triggerToolExecuteAfter,
    triggerPermissionEvaluate: registrations.triggerPermissionEvaluate,
    triggerSessionPrompt: registrations.triggerSessionPrompt,
    triggerSessionContext: registrations.triggerSessionContext,
    applyToolTransforms: registrations.applyToolTransforms,
    registeredTools: registrations.registeredTools,
    dispose: async () => {
      if (typeof cleanup === 'function') await cleanup()
    },
  }
}
