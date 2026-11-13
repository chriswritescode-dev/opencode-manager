import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logger } from './logger'
import { readManagerLogEntries, resetManagerLogBuffer } from './log-buffer'

function captureConsole(method: 'warn' | 'debug'): string[] {
  const lines: string[] = []
  vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    lines.push(String(args[0]))
  })
  return lines
}

describe('logger', () => {
  beforeEach(() => {
    resetManagerLogBuffer()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('info routes into the buffer with level info and source manager', () => {
    logger.info('hello')

    const { entries } = readManagerLogEntries({})
    expect(entries).toHaveLength(1)
    expect(entries[0]?.level).toBe('info')
    expect(entries[0]?.source).toBe('manager')
    expect(entries[0]?.message).toBe('hello')
  })

  it('error folds an Error arg into one composed buffered entry', () => {
    logger.error('failed', new Error('boom'))

    const { entries } = readManagerLogEntries({})
    expect(entries).toHaveLength(1)
    const message = entries[0]?.message
    expect(message).toContain('failed')
    expect(message).toContain('Error')
    expect(message).toContain('boom')
    expect(message).toContain('failed Error: boom')
  })

  it('debug records nothing and writes nothing when ENV.LOGGING.DEBUG is false', () => {
    const debugLines = captureConsole('debug')

    logger.debug('quiet')

    expect(debugLines).toHaveLength(0)
    const { entries, latestSeq } = readManagerLogEntries({})
    expect(entries).toHaveLength(0)
    expect(latestSeq).toBe(0)
  })

  it('warn writes exactly one console line with the level prefix and message', () => {
    const warnLines = captureConsole('warn')

    logger.warn('careful')

    expect(warnLines).toHaveLength(1)
    const line = warnLines[0] ?? ''
    expect(line).toContain('[WARN]')
    expect(line).toContain('careful')
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] \[WARN\] careful$/)
  })
})
