import { readState, type OcmState } from './state.js'
import { getToken, describeTokenStore } from './internal-token-store.js'
import { TokenStoreError } from './token-store.js'
import type { TokenStoreDescription } from './token-store.js'
import { ManagerApi } from './manager-api.js'
import { trimUrlTrailingSlashes } from '@opencode-manager/shared/utils'

export type ManagerAuthFailureReason = 'no-manager' | 'token-store' | 'no-token'

export type ManagerAuth =
  | { ok: true; managerUrl: string; token: string }
  | { ok: false; reason: ManagerAuthFailureReason; message: string }

export type ManagerAuthOk = Extract<ManagerAuth, { ok: true }>

export type ResolveManagerApiResult =
  | { ok: true; auth: ManagerAuthOk; api: ManagerApi }
  | { ok: false; message: string }

export interface ManagerAuthDeps {
  readState: () => OcmState | null
  getToken: (account: string) => Promise<string | null>
  describeTokenStore: () => TokenStoreDescription
}

export const managerAuthDeps: ManagerAuthDeps = { readState, getToken, describeTokenStore }

export async function resolveManagerAuth(
  rawManagerUrl?: string,
  deps: ManagerAuthDeps = managerAuthDeps,
): Promise<ManagerAuth> {
  const requestedUrl = rawManagerUrl ?? deps.readState()?.managerUrl
  const managerUrl = requestedUrl ? trimUrlTrailingSlashes(requestedUrl) : ''
  if (!managerUrl) {
    return {
      ok: false,
      reason: 'no-manager',
      message: 'No manager configured. Run `ocm login <url>` first.',
    }
  }

  let token: string | null
  try {
    token = await deps.getToken(managerUrl)
  } catch (err) {
    if (!(err instanceof TokenStoreError)) throw err
    return {
      ok: false,
      reason: 'token-store',
      message: `token store error (${tokenStoreLabel(deps)}): ${err.message}. Run \`ocm login ${managerUrl}\` after fixing the store.`,
    }
  }

  if (!token) {
    return {
      ok: false,
      reason: 'no-token',
      message: `no token stored for ${managerUrl} (${tokenStoreLabel(deps)}). Run \`ocm login ${managerUrl}\`.`,
    }
  }

  return { ok: true, managerUrl, token }
}

function tokenStoreLabel(deps: ManagerAuthDeps): string {
  const store = deps.describeTokenStore()
  return `${store.kind}: ${store.location}`
}

export async function resolveManagerApi(
  managerUrl?: string,
  deps: ManagerAuthDeps = managerAuthDeps,
): Promise<ResolveManagerApiResult> {
  const auth = await resolveManagerAuth(managerUrl, deps)
  if (!auth.ok) return { ok: false, message: auth.message }
  return { ok: true, auth, api: new ManagerApi(auth.managerUrl, auth.token) }
}
