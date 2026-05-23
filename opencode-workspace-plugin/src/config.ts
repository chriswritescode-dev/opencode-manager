import { getToken } from './keychain.js'

export interface PluginConfig {
  managerUrl: string
  managerToken: string
  connectionId: string
  tokenSource: 'option' | 'env' | 'keychain'
}

export function resolveConfig(options: Record<string, unknown> = {}): PluginConfig {
  const managerUrl = ((options.managerUrl as string) || process.env.OPENCODE_MANAGER_URL || '').replace(/\/+$/, '')
  if (!managerUrl) {
    throw new Error('managerUrl is required. Set it in plugin options or OPENCODE_MANAGER_URL env var.')
  }

  const optionToken = options.managerToken as string | undefined
  const envToken = process.env.OPENCODE_MANAGER_INTERNAL_TOKEN

  let managerToken: string | undefined
  let tokenSource: PluginConfig['tokenSource'] = 'option'
  if (optionToken) {
    managerToken = optionToken
    tokenSource = 'option'
  } else if (envToken) {
    managerToken = envToken
    tokenSource = 'env'
  } else {
    const fromKeychain = getToken(managerUrl)
    if (fromKeychain) {
      managerToken = fromKeychain
      tokenSource = 'keychain'
    }
  }

  if (!managerToken) {
    throw new Error(
      `managerToken not found. Set it in plugin options, OPENCODE_MANAGER_INTERNAL_TOKEN env var, or run \`ocm login ${managerUrl} <token>\` to store it in Keychain.`,
    )
  }

  const connectionId = (options.connectionId as string) || 'default'

  return {
    managerUrl,
    managerToken,
    connectionId,
    tokenSource,
  }
}
