import { ClientError, createOpenCodeApi, openCodeErrorStatus, type OpenCodeApi } from '@opencode-manager/shared/opencode'
import { FetchError } from '@opencode-manager/shared'
import { OPENCODE_API_ENDPOINT } from '@/config'

const openCodeApi = createOpenCodeApi({
  baseUrl: new URL(OPENCODE_API_ENDPOINT, window.location.origin).toString(),
  fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
})

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

export async function callOpenCode<T>(operation: (api: OpenCodeApi) => Promise<T>): Promise<T> {
  try {
    return await operation(openCodeApi)
  } catch (error) {
    throw toFetchError(error)
  }
}
