import { expect, type Mock } from 'vitest'

export interface LoggerMocks {
  info: Mock
  warn: Mock
  error: Mock
  debug: Mock
}

export function loggedArguments(loggerMocks: LoggerMocks): unknown[][] {
  return [...loggerMocks.info.mock.calls, ...loggerMocks.warn.mock.calls, ...loggerMocks.error.mock.calls]
}

export function expectNoSecretsLogged(loggerMocks: LoggerMocks, secrets: readonly string[]): void {
  const calls = loggedArguments(loggerMocks)
  expect(calls.length).toBeGreaterThan(0)

  for (const args of calls) {
    const serialized = JSON.stringify(args)
    for (const value of secrets) {
      expect(serialized).not.toContain(value)
    }
  }
}
