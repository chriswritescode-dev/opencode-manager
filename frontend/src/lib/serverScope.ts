import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'

export function serverScopedKey(
  key: readonly unknown[],
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): readonly unknown[] {
  return serverId === LOCAL_OPENCODE_SERVER_ID ? key : [...key, serverId]
}
