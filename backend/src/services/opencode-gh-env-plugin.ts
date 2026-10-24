import { SANDBOX_SHELL_MARKER_PREFIX, SANDBOX_SHELL_STATE_KEY, SECRET_MASK_STORE_SOURCE } from './opencode-plugin-state'

/**
 * Builds the generated gh-env plugin source.
 *
 * The plugin keeps secret masks per cwd and replaces them on every successful
 * `/shell-env` fetch for that cwd, so a rotated or removed secret stops being
 * masked. A tool result is masked with the masks of the cwd the shell ran in
 * when the tool event exposes one (`cwd` or `workdir` on the input); a tool
 * result that exposes no cwd is masked with the union of the current per-cwd
 * mask sets, never with values that were already replaced.
 *
 * A spawn that belongs to a sandboxed shell asks `/shell-env` to skip the
 * repository env, because the sandbox plan resolves it once for the microVM and
 * registers its mask values through the shared mask store.
 */
export function buildGhEnvPluginSource(id: string): string {
  return `var TTL_MS = 5000
var cache = new Map()
var SHELL_STATE_KEY = Symbol.for(${JSON.stringify(SANDBOX_SHELL_STATE_KEY)})
var SHELL_MARKER_PREFIX = ${JSON.stringify(SANDBOX_SHELL_MARKER_PREFIX)}

${SECRET_MASK_STORE_SOURCE}

function emptyBody() {
  return { env: {}, mask: [] }
}

function isSandboxedShell(event) {
  var state = globalThis[SHELL_STATE_KEY]
  if (state === null || typeof state !== 'object') {
    return typeof event.command === 'string' && event.command.indexOf(SHELL_MARKER_PREFIX) === 0
  }
  var inFlight = state.inFlightSandboxedCommands
  if (!(inFlight instanceof Map)) return false
  return inFlight.has(event.command)
}

async function fetchShellEnv(cwd, sandboxed) {
  const baseUrl = process.env.OCM_INTERNAL_API_URL
  const token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) return emptyBody()
  const now = Date.now()
  const cacheKey = (cwd || '') + (sandboxed ? '\\u0000sandboxed' : '')
  const cached = cache.get(cacheKey)
  if (cached && now < cached.expiry) return cached
  try {
    const url = new URL(baseUrl + '/shell-env')
    if (cwd) url.searchParams.set('cwd', cwd)
    if (sandboxed) url.searchParams.set('sandboxed', '1')
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!res.ok) return cached || emptyBody()
    const body = await res.json()
    const env = body && typeof body.env === 'object' && body.env !== null ? body.env : {}
    const mask = body && Array.isArray(body.mask) ? body.mask : []
    const next = { expiry: now + TTL_MS, env, mask }
    cache.set(cacheKey, next)
    return next
  } catch {
    return cached || emptyBody()
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function resultCwd(event) {
  const input = event.input
  if (input === null || typeof input !== 'object') return null
  if (typeof input.cwd === 'string' && input.cwd.length > 0) return input.cwd
  if (typeof input.workdir === 'string' && input.workdir.length > 0) return input.workdir
  return null
}

function masksForResult(event) {
  const cwd = resultCwd(event)
  if (cwd === null) return allCurrentMaskValues()
  return currentMaskValues(cwd) || allCurrentMaskValues()
}

function containsMask(text, values) {
  for (const value of values) {
    if (text.indexOf(value) !== -1) return true
  }
  return false
}

function applyMasks(text, values) {
  let result = text
  for (const value of values) {
    if (result.indexOf(value) !== -1) result = result.split(value).join('***')
  }
  return result
}

function maskValue(value, values) {
  if (typeof value === 'string') {
    return containsMask(value, values) ? applyMasks(value, values) : value
  }
  if (Array.isArray(value)) {
    let copy = null
    for (let index = 0; index < value.length; index += 1) {
      const masked = maskValue(value[index], values)
      if (masked !== value[index]) {
        if (copy === null) copy = value.slice()
        copy[index] = masked
      }
    }
    return copy === null ? value : copy
  }
  if (isPlainObject(value)) {
    let copy = null
    for (const key of Object.keys(value)) {
      const masked = maskValue(value[key], values)
      if (masked !== value[key]) {
        if (copy === null) copy = Object.assign({}, value)
        copy[key] = masked
      }
    }
    return copy === null ? value : copy
  }
  return value
}

export default {
  id: '${id}',
  async setup(ctx) {
    await ctx.shell.hook('create.before', async (event) => {
      const sandboxed = isSandboxedShell(event)
      const body = await fetchShellEnv(event.cwd, sandboxed)
      if (!sandboxed) replaceMaskValues(event.cwd, body.mask)
      Object.assign(event.env, body.env)
    })
    await ctx.tool.hook('execute.after', async (event) => {
      if (event.status !== 'completed') return
      if (event.result === null || typeof event.result !== 'object') return
      const values = masksForResult(event)
      if (values.length === 0) return
      const source = { ...event.result }
      const masked = maskValue(source, values)
      if (masked !== source) event.result = masked
    })
  },
}
`
}
