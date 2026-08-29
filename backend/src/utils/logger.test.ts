import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logger } from './logger'
import { readManagerLogEntries, resetManagerLogBuffer } from './log-buffer'

type ConsoleSpy = ReturnType<typeof vi.spyOn>

describe('logger', () => {
  let warnSpy: ConsoleSpy
  let debugSpy: ConsoleSpy

  beforeEach(() => {
    resetManagerLogBuffer()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
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
    logger.debug('quiet')

    expect(debugSpy).not.toHaveBeenCalled()
    const { entries, latestSeq } = readManagerLogEntries({})
    expect(entries).toHaveLength(0)
    expect(latestSeq).toBe(0)
  })

  it('warn calls console.warn exactly once with prefixed line containing the message', () => {
    logger.warn('careful')

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const line = warnSpy.mock.calls[0]?.[0] as string
    expect(line).toContain('[WARN]')
    expect(line).toContain('careful')
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] \[WARN\] careful$/)
  })
})
