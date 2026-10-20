import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'

/**
 * Returns the query key for a server-scoped cache entry. Local keys stay untouched so existing
 * prefix-based invalidations keep matching; remote keys get the server id appended last.
 */
export function serverScopedKey(
  key: readonly unknown[],
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): readonly unknown[] {
  return serverId === LOCAL_OPENCODE_SERVER_ID ? key : [...key, serverId]
}
