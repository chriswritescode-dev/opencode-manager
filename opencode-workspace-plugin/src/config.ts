export interface PluginConfig {
  managerUrl: string
  managerToken: string
  connectionId: string
}

export function resolveConfig(options: Record<string, unknown> = {}): PluginConfig {
  const managerUrl = (options.managerUrl as string) || process.env.OPENCODE_MANAGER_URL
  if (!managerUrl) {
    throw new Error('managerUrl is required. Set it in plugin options or OPENCODE_MANAGER_URL env var.')
  }

  const managerToken = (options.managerToken as string) || process.env.OPENCODE_MANAGER_INTERNAL_TOKEN
  if (!managerToken) {
    throw new Error('managerToken is required. Set it in plugin options or OPENCODE_MANAGER_INTERNAL_TOKEN env var.')
  }

  const connectionId = (options.connectionId as string) || 'default'

  return {
    managerUrl,
    managerToken,
    connectionId,
  }
}
