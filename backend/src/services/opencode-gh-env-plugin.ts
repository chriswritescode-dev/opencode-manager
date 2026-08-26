export function buildGhEnvPluginSource(): string {
  return `const TTL_MS = 5000
let cache = new Map()

async function fetchGhEnv(cwd) {
  const baseUrl = process.env.OCM_INTERNAL_API_URL
  const token = process.env.OCM_INTERNAL_TOKEN
  if (!baseUrl || !token) return {}
  const now = Date.now()
  const cacheKey = cwd || ''
  const cached = cache.get(cacheKey)
  if (cached && now < cached.expiry) return cached.env
  try {
    const url = new URL(baseUrl + '/git-credentials/gh-env')
    if (cwd) url.searchParams.set('cwd', cwd)
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!res.ok) return cached?.env || {}
    const env = await res.json()
    const next = { expiry: now + TTL_MS, env: env && typeof env === 'object' ? env : {} }
    cache.set(cacheKey, next)
    return next.env
  } catch {
    return cached?.env || {}
  }
}

export default async function () {
  return {
    'shell.env': async (input, output) => {
      const env = await fetchGhEnv(input.cwd)
      Object.assign(output.env, env)
    },
  }
}
`
}
