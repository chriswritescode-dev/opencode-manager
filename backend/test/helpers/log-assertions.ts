import { expect, type Mock } from 'vitest'
import { DEFAULTS } from '@opencode-manager/shared/config'
import type { ManagerLogEntry, ManagerLogLevel, ManagerLogQuery } from '@opencode-manager/shared/schemas'
import { readManagerLogEntries, resetManagerLogBuffer } from '../../src/utils/log-buffer'

export interface LoggerMocks {
  info: Mock
  warn: Mock
  error: Mock
  debug: Mock
}

export function resetTestLogs(): void {
  resetManagerLogBuffer()
}

export function testLogEntries(level?: ManagerLogLevel): ManagerLogEntry[] {
  const query: ManagerLogQuery = { limit: DEFAULTS.LOGS.MAX_PAGE_SIZE }
  if (level !== undefined) {
    query.level = level
  }
  return readManagerLogEntries(query).entries
}

export function expectLoggedMessage(text: string, level?: ManagerLogLevel): void {
  const entries = testLogEntries(level)
  expect(entries.map((entry) => entry.message)).toContainEqual(expect.stringContaining(text))
}

export function expectNoSecretsLogged(secrets: readonly string[]): void {
  const entries = testLogEntries()
  expect(entries.length).toBeGreaterThan(0)

  for (const entry of entries) {
    for (const value of secrets) {
      expect(entry.message).not.toContain(value)
    }
  }
}

export function expectNoSecretsLoggedOnMocks(loggerMocks: LoggerMocks, secrets: readonly string[]): void {
  const calls = [...loggerMocks.info.mock.calls, ...loggerMocks.warn.mock.calls, ...loggerMocks.error.mock.calls]
  expect(calls.length).toBeGreaterThan(0)

  for (const args of calls) {
    const serialized = JSON.stringify(args)
    for (const value of secrets) {
      expect(serialized).not.toContain(value)
    }
  }
}
