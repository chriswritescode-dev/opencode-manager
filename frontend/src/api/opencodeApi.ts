import { ClientError, createOpenCodeApi, openCodeErrorStatus, type OpenCodeApi } from '@opencode-manager/shared/opencode'
import { FetchError } from '@opencode-manager/shared'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { API_BASE_URL, OPENCODE_API_ENDPOINT } from '@/config'

const openCodeApis = new Map<string, OpenCodeApi>()

/** Base URL of the OpenCode API for a server: the direct local endpoint or the remote proxy. */
export function openCodeApiBaseUrl(serverId: string = LOCAL_OPENCODE_SERVER_ID): string {
  return serverId === LOCAL_OPENCODE_SERVER_ID
    ? OPENCODE_API_ENDPOINT
    : `${API_BASE_URL}/api/opencode/servers/${encodeURIComponent(serverId)}`
}

export function getOpenCodeApi(serverId: string = LOCAL_OPENCODE_SERVER_ID): OpenCodeApi {
  const cached = openCodeApis.get(serverId)
  if (cached) return cached

  const api = createOpenCodeApi({
    baseUrl: new URL(openCodeApiBaseUrl(serverId), window.location.origin).toString(),
    fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
  })
  openCodeApis.set(serverId, api)
  return api
}

function toFetchError(error: unknown): FetchError {
  if (error instanceof FetchError) {
    return error
  }

  if (error instanceof ClientError) {
    const status = (error.cause as { status?: number } | undefined)?.status
    return new FetchError(error.message, status, error.reason)
  }

  const status = openCodeErrorStatus(error)
  if (error instanceof Error) {
    return new FetchError(error.message, status ?? 0, error.name)
  }

  return new FetchError('Request failed', status ?? 0)
}

export async function callOpenCode<T>(
  operation: (api: OpenCodeApi) => Promise<T>,
  serverId: string = LOCAL_OPENCODE_SERVER_ID,
): Promise<T> {
  try {
    return await operation(getOpenCodeApi(serverId))
  } catch (error) {
    throw toFetchError(error)
  }
}
