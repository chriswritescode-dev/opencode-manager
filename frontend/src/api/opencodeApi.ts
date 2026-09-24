import { ClientError, createOpenCodeApi, openCodeErrorStatus } from '@opencode-manager/shared/opencode'
import { FetchError } from '@opencode-manager/shared'
import { OPENCODE_API_ENDPOINT } from '@/config'

export const openCodeApi = createOpenCodeApi({
  baseUrl: new URL(OPENCODE_API_ENDPOINT, window.location.origin).toString(),
  fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
})

export function toFetchError(error: unknown): FetchError {
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
