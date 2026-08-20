import { isProvablyRemoteMcpEntry, isRecord, sanitizeConfigForEnforcement } from './enforcement-config'

export type SandboxProxyDecision = { blocked: true; reason: string } | { blocked: false }

export const SANDBOX_BLOCKED_REASON_PREFIX = 'Sandbox enforcement is on; host-process shell execution is disabled: '

export const SANDBOX_CONFIG_MUTATION_REASON_PREFIX =
  'Sandbox enforcement is on; config mutations that could re-enable host-process execution are disabled: '

const ENCODED_PATH_HAZARD =
  /%(?:2f|5c|25|00|01|02|03|04|05|06|07|08|09|0a|0b|0c|0d|0e|0f|10|11|12|13|14|15|16|17|18|19|1a|1b|1c|1d|1e|1f|7f)/i

function stripSandboxProxyApiPrefix(pathname: string): string {
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return pathname.slice(4) || '/'
  }
  return pathname
}

function isAmbiguousSandboxProxyPath(pathname: string): boolean {
  return pathname !== '/' && (pathname.includes('//') || pathname.endsWith('/'))
}

function canonicalizeSandboxProxyPath(pathname: string): string | null {
  if (isAmbiguousSandboxProxyPath(pathname)) return null
  if (!pathname.includes('%')) return stripSandboxProxyApiPrefix(pathname)
  if (ENCODED_PATH_HAZARD.test(pathname)) return null
  try {
    return stripSandboxProxyApiPrefix(decodeURIComponent(pathname))
  } catch {
    return null
  }
}

const BLOCKED_ENFORCED_ROUTES: ReadonlyArray<{
  methods: readonly string[]
  pathPattern: RegExp
  reason: string
}> = [
  {
    methods: ['POST'],
    pathPattern: /^\/pty$/,
    reason: 'PTY creation runs commands in the OpenCode host process',
  },
  {
    methods: ['GET', 'POST'],
    pathPattern: /^\/pty\/[^/]+\/connect$/,
    reason: 'PTY connections drive processes in the OpenCode host process',
  },
]

export function decideSandboxProxyBlock(enforced: boolean, method: string, pathname: string): SandboxProxyDecision {
  if (!enforced) {
    return { blocked: false }
  }
  const normalizedMethod = method.toUpperCase()
  const canonicalPath = canonicalizeSandboxProxyPath(pathname)
  if (canonicalPath === null) {
    return {
      blocked: true,
      reason: `${SANDBOX_BLOCKED_REASON_PREFIX}the request path could not be safely canonicalized`,
    }
  }
  for (const route of BLOCKED_ENFORCED_ROUTES) {
    if (route.methods.includes(normalizedMethod) && route.pathPattern.test(canonicalPath)) {
      return { blocked: true, reason: `${SANDBOX_BLOCKED_REASON_PREFIX}${route.reason}` }
    }
  }
  return { blocked: false }
}

export function isSandboxConfigMutation(enforced: boolean, method: string, pathname: string): boolean {
  if (!enforced) {
    return false
  }
  const canonicalPath = canonicalizeSandboxProxyPath(pathname)
  if (canonicalPath === null) {
    return false
  }
  return method.toUpperCase() === 'PATCH' && canonicalPath === '/config'
}

export function isSandboxMcpAdd(enforced: boolean, method: string, pathname: string): boolean {
  if (!enforced) {
    return false
  }
  const canonicalPath = canonicalizeSandboxProxyPath(pathname)
  if (canonicalPath === null) {
    return false
  }
  return method.toUpperCase() === 'POST' && canonicalPath === '/mcp'
}

export function isSandboxAuthWrite(enforced: boolean, method: string, pathname: string): boolean {
  if (!enforced) {
    return false
  }
  const canonicalPath = canonicalizeSandboxProxyPath(pathname)
  if (canonicalPath === null) {
    return false
  }
  return method.toUpperCase() === 'PUT' && /^\/auth\/[^/]+$/.test(canonicalPath)
}

export type SandboxConfigBodyDecision =
  | { kind: 'passthrough' }
  | { kind: 'sanitized'; body: string }
  | { kind: 'reject'; reason: string }

export function decideSandboxConfigBody(
  enforced: boolean,
  method: string,
  pathname: string,
  rawBody: string,
): SandboxConfigBodyDecision {
  if (!isSandboxConfigMutation(enforced, method, pathname)) {
    return { kind: 'passthrough' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return {
      kind: 'reject',
      reason: `${SANDBOX_CONFIG_MUTATION_REASON_PREFIX}the config mutation body is not valid JSON`,
    }
  }
  if (!isRecord(parsed)) {
    return {
      kind: 'reject',
      reason: `${SANDBOX_CONFIG_MUTATION_REASON_PREFIX}the config mutation body must be a JSON object`,
    }
  }
  return { kind: 'sanitized', body: JSON.stringify(sanitizeConfigForEnforcement(parsed, true)) }
}

export function decideSandboxMcpAddBody(
  enforced: boolean,
  method: string,
  pathname: string,
  rawBody: string,
): SandboxConfigBodyDecision {
  if (!isSandboxMcpAdd(enforced, method, pathname)) {
    return { kind: 'passthrough' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return {
      kind: 'reject',
      reason: `${SANDBOX_CONFIG_MUTATION_REASON_PREFIX}the MCP server body is not valid JSON`,
    }
  }
  if (!isRecord(parsed)) {
    return {
      kind: 'reject',
      reason: `${SANDBOX_CONFIG_MUTATION_REASON_PREFIX}the MCP server body must be a JSON object`,
    }
  }
  if (!isProvablyRemoteMcpEntry(parsed.config)) {
    return {
      kind: 'reject',
      reason: `${SANDBOX_CONFIG_MUTATION_REASON_PREFIX}only remote MCP servers can be added while enforcement is active`,
    }
  }
  return { kind: 'passthrough' }
}

export function decideSandboxAuthBody(
  enforced: boolean,
  method: string,
  pathname: string,
  rawBody: string,
): SandboxConfigBodyDecision {
  if (!isSandboxAuthWrite(enforced, method, pathname)) {
    return { kind: 'passthrough' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return {
      kind: 'reject',
      reason: `${SANDBOX_CONFIG_MUTATION_REASON_PREFIX}the auth body is not valid JSON`,
    }
  }
  if (!isRecord(parsed)) {
    return {
      kind: 'reject',
      reason: `${SANDBOX_CONFIG_MUTATION_REASON_PREFIX}the auth body must be a JSON object`,
    }
  }
  if (parsed.type === 'wellknown') {
    return {
      kind: 'reject',
      reason: `${SANDBOX_CONFIG_MUTATION_REASON_PREFIX}well-known provider authentication loads remote host-executed code and cannot be added while enforcement is active`,
    }
  }
  return { kind: 'passthrough' }
}

export function decideSandboxMutationBody(
  enforced: boolean,
  method: string,
  pathname: string,
  rawBody: string,
): SandboxConfigBodyDecision {
  if (isSandboxMcpAdd(enforced, method, pathname)) {
    return decideSandboxMcpAddBody(enforced, method, pathname, rawBody)
  }
  if (isSandboxAuthWrite(enforced, method, pathname)) {
    return decideSandboxAuthBody(enforced, method, pathname, rawBody)
  }
  return decideSandboxConfigBody(enforced, method, pathname, rawBody)
}
