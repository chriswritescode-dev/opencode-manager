export function buildGhEnvPluginSource(id: string): string {
  return `const TTL_MS = 5000
let cache = new Map()
const maskValues = new Set()

function rememberMasks(values) {
  if (!Array.isArray(values)) return
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) maskValues.add(value)
  }
}

function emptyBody() {
  return { env: {}, mask: [] }
}

async function fetchShellEnv(cwd) {
  const baseUrl = process.env.OCM_INTERNAL_API_URL
  const token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) return emptyBody()
  const now = Date.now()
  const cacheKey = cwd || ''
  const cached = cache.get(cacheKey)
  if (cached && now < cached.expiry) return cached
  try {
    const url = new URL(baseUrl + '/shell-env')
    if (cwd) url.searchParams.set('cwd', cwd)
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

function containsMask(text) {
  for (const value of maskValues) {
    if (text.indexOf(value) !== -1) return true
  }
  return false
}

function applyMasks(text) {
  let result = text
  const ordered = Array.from(maskValues).sort(function (a, b) { return b.length - a.length })
  for (const value of ordered) {
    if (result.indexOf(value) !== -1) result = result.split(value).join('***')
  }
  return result
}

function maskValue(value) {
  if (typeof value === 'string') {
    return containsMask(value) ? applyMasks(value) : value
  }
  if (Array.isArray(value)) {
    let copy = null
    for (let index = 0; index < value.length; index += 1) {
      const masked = maskValue(value[index])
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
      const masked = maskValue(value[key])
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
      const body = await fetchShellEnv(event.cwd)
      rememberMasks(body.mask)
      Object.assign(event.env, body.env)
    })
    await ctx.tool.hook('execute.after', async (event) => {
      if (event.status !== 'completed') return
      if (maskValues.size === 0) return
      if (event.result === null || typeof event.result !== 'object') return
      const source = { ...event.result }
      const masked = maskValue(source)
      if (masked !== source) event.result = masked
    })
  },
}
`
}
