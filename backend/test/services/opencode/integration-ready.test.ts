import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INTEGRATION_READY_POLL_INTERVAL_MS,
  INTEGRATION_READY_TIMEOUT_MS,
  runWhenIntegrationReady,
} from '../../../src/services/opencode/integration-ready'
import { createStubOpenCodeClient } from '../../helpers/stub-opencode-client'

const TARGET = { integrationID: 'anthropic', location: { directory: '/tmp/repo' } }

function taggedError(tag: string, message: string): Error {
  return Object.assign(new Error(message), { _tag: tag })
}

function notFound(): Error {
  return taggedError('IntegrationNotFoundError', 'Integration not found: anthropic')
}

describe('runWhenIntegrationReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the first result without polling', async () => {
    const { api } = createStubOpenCodeClient()
    const action = vi.fn(async () => 'connected')

    await expect(runWhenIntegrationReady(api, TARGET, action)).resolves.toBe('connected')

    expect(action).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.integration.get)).not.toHaveBeenCalled()
  })

  it('waits for a loading integration and retries once', async () => {
    const { api } = createStubOpenCodeClient()
    const get = vi.mocked(api.integration.get)
    get.mockRejectedValueOnce(notFound()).mockRejectedValueOnce(notFound())
    const action = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce('connected')

    const result = runWhenIntegrationReady(api, TARGET, action)
    await vi.advanceTimersByTimeAsync(INTEGRATION_READY_POLL_INTERVAL_MS * 3)

    await expect(result).resolves.toBe('connected')
    expect(get).toHaveBeenCalledTimes(3)
    expect(get).toHaveBeenCalledWith(TARGET)
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('returns the original error when the integration never appears', async () => {
    const { api } = createStubOpenCodeClient()
    const get = vi.mocked(api.integration.get)
    get.mockRejectedValue(notFound())
    const original = notFound()
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(original)

    const result = runWhenIntegrationReady(api, TARGET, action)
    const assertion = expect(result).rejects.toBe(original)
    await vi.advanceTimersByTimeAsync(INTEGRATION_READY_TIMEOUT_MS + INTEGRATION_READY_POLL_INTERVAL_MS)

    await assertion
    expect(action).toHaveBeenCalledTimes(1)
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(INTEGRATION_READY_TIMEOUT_MS / INTEGRATION_READY_POLL_INTERVAL_MS - 1)
    expect(get.mock.calls.length).toBeLessThanOrEqual(INTEGRATION_READY_TIMEOUT_MS / INTEGRATION_READY_POLL_INTERVAL_MS)
  })

  it('stops polling and returns the original error when the lookup fails differently', async () => {
    const { api } = createStubOpenCodeClient()
    const get = vi.mocked(api.integration.get)
    get.mockRejectedValue(taggedError('ServiceUnavailableError', 'down'))
    const original = notFound()
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(original)

    const result = runWhenIntegrationReady(api, TARGET, action)
    const assertion = expect(result).rejects.toBe(original)
    await vi.advanceTimersByTimeAsync(INTEGRATION_READY_POLL_INTERVAL_MS)

    await assertion
    expect(get).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('does not retry other errors', async () => {
    const { api } = createStubOpenCodeClient()
    const original = taggedError('InvalidRequestError', 'Missing required form field: account')
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(original)

    await expect(runWhenIntegrationReady(api, TARGET, action)).rejects.toBe(original)

    expect(action).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.integration.get)).not.toHaveBeenCalled()
  })
})
