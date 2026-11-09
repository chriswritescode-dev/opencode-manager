import { describe, it, expect } from 'vitest'
import { FetchError } from '@opencode-manager/shared'
import { isConnectivityError, parseNetworkError, isGatewayTimeout } from './opencode-errors'

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

describe('isConnectivityError', () => {
  it('returns true for a fetch network TypeError', () => {
    expect(isConnectivityError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('returns true for a FetchError with statusCode 0 and code TypeError', () => {
    expect(isConnectivityError(new FetchError('Network unreachable', 0, 'TypeError'))).toBe(true)
  })

  it('returns false for other status-0 FetchErrors', () => {
    expect(isConnectivityError(new FetchError('The operation was aborted.', 0, 'AbortError'))).toBe(false)
    expect(isConnectivityError(new FetchError('Unexpected token', 0, 'SyntaxError'))).toBe(false)
    expect(isConnectivityError(new FetchError('Network unreachable', 0))).toBe(false)
  })

  it('returns false for a FetchError carrying an HTTP status', () => {
    expect(isConnectivityError(new FetchError('Bad gateway', 502))).toBe(false)
    expect(isConnectivityError(new FetchError('Request timeout', 408, 'TIMEOUT'))).toBe(false)
  })

  it('returns false for aborts', () => {
    expect(isConnectivityError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(false)
    const abort = new Error('The operation was aborted.')
    abort.name = 'AbortError'
    expect(isConnectivityError(abort)).toBe(false)
  })

  it('returns false for other errors and values', () => {
    expect(isConnectivityError(new Error('boom'))).toBe(false)
    expect(isConnectivityError(undefined)).toBe(false)
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
