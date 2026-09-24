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
  [key: string]: unknown
}

export type GeneratedTool = {
  name: string
  description?: string
  input?: unknown
  execute?: (input: unknown, context: { signal: AbortSignal }) => Promise<unknown>
  [key: string]: unknown
}

export type GeneratedPlugin = {
  id: string
  triggerShellCreateBefore: (event: ShellCreateBeforeEvent) => Promise<void>
  triggerToolExecuteAfter: (event: ToolExecuteAfterEvent) => Promise<void>
  registeredTools: () => GeneratedTool[]
}

type ShellHookCallback = (event: ShellCreateBeforeEvent) => Promise<void> | void
type ToolHookCallback = (event: ToolExecuteAfterEvent) => Promise<void> | void
type ToolTransformCallback = (editor: { add: (tool: GeneratedTool) => void }) => void

type Registration = { dispose: () => Promise<void> }

type PluginContext = {
  shell: {
    hook: (name: string, callback: ShellHookCallback) => Promise<Registration>
  }
  tool: {
    hook: (name: string, callback: ToolHookCallback) => Promise<Registration>
    transform: (callback: ToolTransformCallback) => Promise<Registration>
  }
}

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

function createPluginContext() {
  const shellCreateBefore = createRegistry<ShellCreateBeforeEvent>('create.before')
  const toolExecuteAfter = createRegistry<ToolExecuteAfterEvent>('execute.after')
  const transforms: ToolTransformCallback[] = []

  const context: PluginContext = {
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
  }

  return {
    context,
    triggerShellCreateBefore: (event: ShellCreateBeforeEvent) => shellCreateBefore.trigger(event),
    triggerToolExecuteAfter: (event: ToolExecuteAfterEvent) => toolExecuteAfter.trigger(event),
    registeredTools: () => {
      const tools: GeneratedTool[] = []
      const editor = { add: (tool: GeneratedTool) => tools.push(tool) }
      for (const transform of transforms) transform(editor)
      return tools
    },
  }
}

let importCount = 0

export async function loadGeneratedPlugin(file: string): Promise<GeneratedPlugin> {
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

  const registrations = createPluginContext()
  await (setup as (context: PluginContext) => Promise<void> | void)(registrations.context)
  return {
    id,
    triggerShellCreateBefore: registrations.triggerShellCreateBefore,
    triggerToolExecuteAfter: registrations.triggerToolExecuteAfter,
    registeredTools: registrations.registeredTools,
  }
}
