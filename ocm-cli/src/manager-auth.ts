import { readState } from './state.js'
import { getToken, describeTokenStore } from './internal-token-store.js'
import { TokenStoreError } from './token-store.js'
import { ManagerApi } from './manager-api.js'

export type ManagerAuthFailureReason = 'no-manager' | 'token-store' | 'no-token'

export type ManagerAuth =
  | { ok: true; managerUrl: string; token: string }
  | { ok: false; reason: ManagerAuthFailureReason; message: string }

export type ManagerAuthOk = Extract<ManagerAuth, { ok: true }>

export type ResolveManagerApiResult =
  | { ok: true; auth: ManagerAuthOk; api: ManagerApi }
  | { ok: false; message: string }

/** Canonical Manager URL form used as the token-store account: trimmed, without trailing slashes. */
export function normalizeManagerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export async function resolveManagerAuth(
  rawManagerUrl: string | undefined = readState()?.managerUrl,
): Promise<ManagerAuth> {
  const managerUrl = rawManagerUrl ? normalizeManagerUrl(rawManagerUrl) : ''
  if (!managerUrl) {
    return {
      ok: false,
      reason: 'no-manager',
      message: 'No manager configured. Run `ocm login <url>` first.',
    }
  }

  let token: string | null
  try {
    token = await getToken(managerUrl)
  } catch (err) {
    if (!(err instanceof TokenStoreError)) throw err
    return {
      ok: false,
      reason: 'token-store',
      message: `token store error (${tokenStoreLabel()}): ${err.message}. Run \`ocm login ${managerUrl}\` after fixing the store.`,
    }
  }

  if (!token) {
    return {
      ok: false,
      reason: 'no-token',
      message: `no token stored for ${managerUrl} (${tokenStoreLabel()}). Run \`ocm login ${managerUrl}\`.`,
    }
  }

  return { ok: true, managerUrl, token }
}

function tokenStoreLabel(): string {
  const store = describeTokenStore()
  return `${store.kind}: ${store.location}`
}

export async function resolveManagerApi(managerUrl?: string): Promise<ResolveManagerApiResult> {
  const auth = await resolveManagerAuth(managerUrl)
  if (!auth.ok) return { ok: false, message: auth.message }
  return { ok: true, auth, api: new ManagerApi(auth.managerUrl, auth.token) }
}
