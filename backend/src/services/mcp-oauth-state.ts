export interface McpOAuthFlow {
  state: string
  serverName: string
  integrationID: string
  attemptID: string
  callbackPort: number
  directory?: string
  timestamp: number
}

const flowStore = new Map<string, McpOAuthFlow>()
const attemptStore = new Map<string, McpOAuthFlow>()
const FLOW_TTL_MS = 10 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [key, flow] of flowStore) {
    if (now - flow.timestamp > FLOW_TTL_MS) {
      flowStore.delete(key)
    }
  }
  for (const [key, flow] of attemptStore) {
    if (now - flow.timestamp > FLOW_TTL_MS) {
      attemptStore.delete(key)
    }
  }
}, CLEANUP_INTERVAL_MS)

export function storeMcpOAuthFlow(flow: Omit<McpOAuthFlow, 'timestamp'>): void {
  const entry = { ...flow, timestamp: Date.now() }
  flowStore.set(flow.state, entry)
  attemptStore.set(flow.attemptID, entry)
}

export function consumeMcpOAuthFlow(state: string): McpOAuthFlow | undefined {
  const flow = flowStore.get(state)
  if (flow) {
    flowStore.delete(state)
  }
  return flow
}

export function getMcpOAuthFlowByAttempt(attemptID: string): McpOAuthFlow | undefined {
  return attemptStore.get(attemptID)
}
