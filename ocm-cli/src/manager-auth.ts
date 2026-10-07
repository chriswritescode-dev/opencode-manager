import { readState } from './state.js'
import { getToken } from './internal-token-store.js'
import { TokenStoreError } from './token-store.js'

export type ManagerAuth =
  | { ok: true; managerUrl: string; token: string }
  | { ok: false; message: string }

export type ManagerAuthOk = Extract<ManagerAuth, { ok: true }>

/** Canonical Manager URL form used as the token-store account: trimmed, without trailing slashes. */
export function normalizeManagerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export async function resolveManagerAuth(
  rawManagerUrl: string | undefined = readState()?.managerUrl,
): Promise<ManagerAuth> {
  const managerUrl = rawManagerUrl ? normalizeManagerUrl(rawManagerUrl) : ''
  if (!managerUrl) {
    return { ok: false, message: 'No manager configured. Run `ocm login <url>` first.' }
  }

  let token: string | null
  try {
    token = await getToken(managerUrl)
  } catch (err) {
    const reason = err instanceof TokenStoreError ? err.message : String(err)
    return { ok: false, message: `Token store unavailable: ${reason}` }
  }

  if (!token) {
    return { ok: false, message: `No token stored. Run \`ocm login ${managerUrl}\`.` }
  }

  return { ok: true, managerUrl, token }
}
