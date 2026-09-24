import packageJson from '../package.json' with { type: 'json' }

export const OCM_VERSION = packageJson.version
export const MIN_MANAGER_VERSION = '0.19.0'

export class ManagerTooOldError extends Error {
  constructor(managerUrl: string) {
    super(`OpenCode Manager at ${managerUrl} is too old for ocm ${OCM_VERSION}; upgrade the Manager to >= ${MIN_MANAGER_VERSION}`)
    this.name = 'ManagerTooOldError'
  }
}

export class RepoProxyNotFoundError extends Error {
  constructor(managerUrl: string, repoId: number) {
    super(`repo ${repoId} is not available on OpenCode Manager at ${managerUrl} (missing or not ready)`)
    this.name = 'RepoProxyNotFoundError'
  }
}

export type WarmRepoProxyOptions = {
  attempts?: number
  fetch?: typeof fetch
  wait?: (ms: number) => Promise<void>
}

export function repoProxyUrl(managerUrl: string, repoId: number): string {
  return `${managerUrl}/api/opencode-proxy/repos/${repoId}`
}

function isRepoNotFoundBody(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null && (parsed as { error?: unknown }).error === 'Repo not found'
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function warmRepoProxy(managerUrl: string, token: string, repoId: number, options: WarmRepoProxyOptions = {}): Promise<void> {
  const fetchImpl = options.fetch ?? fetch
  const attempts = options.attempts ?? 3
  const wait = options.wait ?? delay
  const url = `${repoProxyUrl(managerUrl, repoId)}/api/session?limit=1`

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
    if (res) {
      const body = await res.text().catch(() => '')
      if (res.ok) return
      if (res.status === 404) {
        throw isRepoNotFoundBody(body) ? new RepoProxyNotFoundError(managerUrl, repoId) : new ManagerTooOldError(managerUrl)
      }
    }
    if (attempt < attempts) await wait(attempt * 500)
  }
}
