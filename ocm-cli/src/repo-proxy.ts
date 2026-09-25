import packageJson from '../package.json' with { type: 'json' }
import { delay } from './delay.js'
import { describeCause } from './token-store.js'

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

export class ManagerTokenInvalidError extends Error {
  constructor(managerUrl: string) {
    super(`OpenCode Manager rejected the token for ${managerUrl} (HTTP 401). The token may have been rotated: copy the current one from Settings -> Manager Internal Token, then run \`ocm login ${managerUrl}\` to store it again.`)
    this.name = 'ManagerTokenInvalidError'
  }
}

export class RepoProxyResponseError extends Error {
  constructor(managerUrl: string, status: number, body: string) {
    const detail = body.trim()
    super(`OpenCode Manager at ${managerUrl} returned HTTP ${status} from the repo proxy${detail ? `: ${detail}` : ''}`)
    this.name = 'RepoProxyResponseError'
  }
}

export class RepoProxyUnreachableError extends Error {
  constructor(managerUrl: string, cause: unknown) {
    super(`could not reach OpenCode Manager at ${managerUrl}: ${describeCause(cause)}`, { cause })
    this.name = 'RepoProxyUnreachableError'
  }
}

export type WarmRepoProxyOptions = {
  attempts?: number
  fetch?: typeof fetch
  wait?: (ms: number) => Promise<void>
}

export function repoProxyBaseUrl(managerUrl: string): string {
  return `${managerUrl}/api/opencode-proxy`
}

export function repoProxyUrl(managerUrl: string, repoId: number): string {
  return `${repoProxyBaseUrl(managerUrl)}/repos/${repoId}`
}

function isRepoNotFoundBody(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null && (parsed as { error?: unknown }).error === 'Repo not found'
  } catch {
    return false
  }
}

export async function warmRepoProxy(managerUrl: string, token: string, repoId: number, options: WarmRepoProxyOptions = {}): Promise<void> {
  const fetchImpl = options.fetch ?? fetch
  const attempts = Math.max(1, options.attempts ?? 3)
  const wait = options.wait ?? delay
  const url = `${repoProxyUrl(managerUrl, repoId)}/api/session?limit=1`

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response | null = null
    let networkError: unknown
    try {
      res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } })
    } catch (err) {
      networkError = err
    }

    const isFinalAttempt = attempt === attempts

    if (res) {
      const body = await res.text().catch(() => '')
      if (res.ok) return
      if (res.status === 404) {
        throw isRepoNotFoundBody(body) ? new RepoProxyNotFoundError(managerUrl, repoId) : new ManagerTooOldError(managerUrl)
      }
      if (res.status === 401) {
        throw new ManagerTokenInvalidError(managerUrl)
      }
      if (isFinalAttempt) {
        throw new RepoProxyResponseError(managerUrl, res.status, body)
      }
    } else if (isFinalAttempt) {
      throw new RepoProxyUnreachableError(managerUrl, networkError)
    }

    await wait(attempt * 500)
  }
}
