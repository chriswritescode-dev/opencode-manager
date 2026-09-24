import { describe, it, expect } from 'vitest'
import { FetchError } from '@opencode-manager/shared'
import { parseNetworkError, parseOpenCodeError, isGatewayTimeout } from './opencode-errors'

describe('parseOpenCodeError', () => {
  it('reads a V2 declared error body with its name, message, and status', () => {
    expect(parseOpenCodeError({
      name: 'SessionBusyError',
      data: { message: 'Session is busy', status: 409 },
    })).toEqual({
      title: 'SessionBusyError',
      message: 'Session is busy',
      isRetryable: false,
      statusCode: 409,
    })
  })

  it('treats a statusless V2 error as retryable', () => {
    expect(parseOpenCodeError({ name: 'UnknownError', data: { message: 'Boom' } })).toEqual({
      title: 'UnknownError',
      message: 'Boom',
      isRetryable: true,
    })
  })

  it('reads a V2 ClientError reason from the error message', () => {
    expect(parseOpenCodeError({
      name: 'ClientError',
      message: 'Transport',
      reason: 'Transport',
    })).toEqual({
      title: 'Error',
      message: 'Transport',
      isRetryable: true,
    })
  })

  it('returns null when there is no message to show', () => {
    expect(parseOpenCodeError({ name: 'Error' })).toBeNull()
    expect(parseOpenCodeError(undefined)).toBeNull()
  })
})

describe('parseNetworkError', () => {
  it('classifies TypeError("Failed to fetch") as Connection Failed', () => {
    const result = parseNetworkError(new TypeError('Failed to fetch'))
    expect(result).toEqual({
      title: 'Connection Failed',
      message: 'Could not connect to the server. Please check your connection.',
      isRetryable: true,
    })
  })

  it('classifies Error("fetch failed") as Connection Failed', () => {
    const result = parseNetworkError(new Error('fetch failed'))
    expect(result).toEqual({
      title: 'Connection Failed',
      message: 'Could not connect to the server. Please check your connection.',
      isRetryable: true,
    })
  })

  it('classifies Error("Network Error") as Connection Failed', () => {
    const result = parseNetworkError(new Error('Network Error'))
    expect(result).toEqual({
      title: 'Connection Failed',
      message: 'Could not connect to the server. Please check your connection.',
      isRetryable: true,
    })
  })

  it('classifies Error("ECONNREFUSED") as Connection Failed', () => {
    const result = parseNetworkError(new Error('ECONNREFUSED'))
    expect(result).toEqual({
      title: 'Connection Failed',
      message: 'Could not connect to the server. Please check your connection.',
      isRetryable: true,
    })
  })

  it('classifies Error("ECONNRESET") as Connection Failed', () => {
    const result = parseNetworkError(new Error('ECONNRESET'))
    expect(result).toEqual({
      title: 'Connection Failed',
      message: 'Could not connect to the server. Please check your connection.',
      isRetryable: true,
    })
  })

  it('classifies Error("networkerror") as Connection Failed', () => {
    const result = parseNetworkError(new Error('networkerror'))
    expect(result).toEqual({
      title: 'Connection Failed',
      message: 'Could not connect to the server. Please check your connection.',
      isRetryable: true,
    })
  })

  it('classifies Error("502 Bad Gateway") as Server Unavailable', () => {
    const result = parseNetworkError(new Error('502 Bad Gateway'))
    expect(result).toEqual({
      title: 'Server Unavailable',
      message: 'The OpenCode server is not responding. It may need to be restarted.',
      isRetryable: true,
    })
  })

  it('classifies timeout errors as Request Timeout', () => {
    const result = parseNetworkError(new Error('Request timeout'))
    expect(result).toEqual({
      title: 'Request Timeout',
      message: 'The request took too long to complete. Please try again.',
      isRetryable: true,
    })
  })

  it('classifies FetchError with statusCode 502 as Server Unavailable', () => {
    const result = parseNetworkError(new FetchError('Proxy request failed', 502))
    expect(result).toEqual({
      title: 'Server Unavailable',
      message: 'The OpenCode server is not responding. It may need to be restarted.',
      isRetryable: true,
    })
  })

  it('classifies FetchError with statusCode 524 as Request Timeout', () => {
    const result = parseNetworkError(new FetchError('An error occurred', 524))
    expect(result).toEqual({
      title: 'Request Timeout',
      message: 'The request took too long to complete. Please try again.',
      isRetryable: true,
    })
  })
})

describe('isGatewayTimeout', () => {
  it('returns true for a FetchError with statusCode 524', () => {
    expect(isGatewayTimeout(new FetchError('Gateway timeout', 524))).toBe(true)
  })

  it('returns false for a FetchError with statusCode 502', () => {
    expect(isGatewayTimeout(new FetchError('Bad gateway', 502))).toBe(false)
  })

  it('returns false for a TypeError', () => {
    expect(isGatewayTimeout(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('returns false for non-error values', () => {
    expect(isGatewayTimeout(undefined)).toBe(false)
    expect(isGatewayTimeout(524)).toBe(false)
  })
})
