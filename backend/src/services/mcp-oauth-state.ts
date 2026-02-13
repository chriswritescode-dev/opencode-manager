export interface McpOAuthFlowState {
  serverName: string
  serverUrl: string
  codeVerifier: string
  clientId: string
  clientSecret?: string
  callbackUrl: string
  tokenEndpoint: string
  timestamp: number
  directory?: string
}

export type McpOAuthFlowResult = 
  | { status: 'pending' }
  | { status: 'completed'; serverName: string }
  | { status: 'failed'; error: string }

const flowStore = new Map<string, McpOAuthFlowState>()
const resultStore = new Map<string, McpOAuthFlowResult & { timestamp: number }>()
const STATE_TTL_MS = 10 * 60 * 1000
const RESULT_TTL_MS = 5 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [key, value] of flowStore) {
    if (now - value.timestamp > STATE_TTL_MS) {
      flowStore.delete(key)
    }
  }
  for (const [key, value] of resultStore) {
    if (now - value.timestamp > RESULT_TTL_MS) {
      resultStore.delete(key)
    }
  }
}, CLEANUP_INTERVAL_MS)

export function storeMcpOAuthFlow(state: string, data: Omit<McpOAuthFlowState, 'timestamp'>): void {
  flowStore.set(state, { ...data, timestamp: Date.now() })
  resultStore.set(state, { status: 'pending', timestamp: Date.now() })
}

export function consumeMcpOAuthFlow(state: string): McpOAuthFlowState | undefined {
  const data = flowStore.get(state)
  if (data) {
    flowStore.delete(state)
  }
  return data
}

export function deleteMcpOAuthFlow(state: string): void {
  flowStore.delete(state)
}

export function markMcpOAuthFlowCompleted(state: string, serverName: string): void {
  resultStore.set(state, { status: 'completed', serverName, timestamp: Date.now() })
}

export function markMcpOAuthFlowFailed(state: string, error: string): void {
  resultStore.set(state, { status: 'failed', error, timestamp: Date.now() })
}

export function getMcpOAuthFlowResult(state: string): McpOAuthFlowResult | undefined {
  const entry = resultStore.get(state)
  if (!entry) return undefined
  if (entry.status === 'completed') return { status: entry.status, serverName: entry.serverName }
  if (entry.status === 'failed') return { status: entry.status, error: entry.error }
  return { status: entry.status }
}
