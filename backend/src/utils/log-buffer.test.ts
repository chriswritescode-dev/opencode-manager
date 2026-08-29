import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULTS } from '@opencode-manager/shared/config'
import {
  appendManagerLogEntry,
  createProcessLogForwarder,
  readManagerLogEntries,
  resetManagerLogBuffer,
} from './log-buffer'

describe('log buffer', () => {
  beforeEach(() => {
    resetManagerLogBuffer()
  })

  it('returns an appended entry with seq 1, ISO timestamp and latestSeq 1', () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'hello' })

    const result = readManagerLogEntries({})
    expect(result.entries).toHaveLength(1)
    const entry = result.entries.at(0)
    expect(entry?.seq).toBe(1)
    expect(entry?.level).toBe('info')
    expect(entry?.source).toBe('manager')
    expect(entry?.message).toBe('hello')
    expect(() => new Date(entry?.timestamp ?? '').toISOString()).not.toThrow()
    expect(result.latestSeq).toBe(1)
  })

  it('afterSeq returns only newer entries', () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'one' })
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'two' })
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'three' })

    const result = readManagerLogEntries({ afterSeq: 2 })
    expect(result.entries.map((entry) => entry.message)).toEqual(['three'])
  })

  it('an afterSeq query with more than DEFAULT_PAGE_SIZE matches drains pages oldest-first without gaps', () => {
    const total = DEFAULTS.LOGS.DEFAULT_PAGE_SIZE + 2
    for (let i = 0; i < total; i++) {
      appendManagerLogEntry({ level: 'info', source: 'manager', message: `entry-${i}` })
    }

    const firstPage = readManagerLogEntries({ afterSeq: 0 })
    expect(firstPage.entries).toHaveLength(DEFAULTS.LOGS.DEFAULT_PAGE_SIZE)
    expect(firstPage.entries[0]?.seq).toBe(1)
    expect(firstPage.entries.at(-1)?.seq).toBe(DEFAULTS.LOGS.DEFAULT_PAGE_SIZE)

    const secondPage = readManagerLogEntries({
      afterSeq: firstPage.entries.at(-1)?.seq,
    })
    expect(secondPage.entries.map((entry) => entry.seq)).toEqual([
      DEFAULTS.LOGS.DEFAULT_PAGE_SIZE + 1,
      DEFAULTS.LOGS.DEFAULT_PAGE_SIZE + 2,
    ])

    const drainedSeqs = [...firstPage.entries, ...secondPage.entries].map((entry) => entry.seq)
    expect(drainedSeqs).toHaveLength(total)
    drainedSeqs.forEach((seq, index) => {
      expect(seq).toBe(index + 1)
    })
  })

  it('keeps only the newest BUFFER_CAPACITY entries and reports evictions', () => {
    const total = DEFAULTS.LOGS.BUFFER_CAPACITY + 5
    for (let i = 0; i < total; i++) {
      appendManagerLogEntry({ level: 'info', source: 'manager', message: `entry-${i}` })
    }

    const newestPage = readManagerLogEntries({ limit: DEFAULTS.LOGS.MAX_PAGE_SIZE })
    expect(newestPage.dropped).toBe(5)
    expect(newestPage.oldestSeq).toBe(6)
    expect(newestPage.latestSeq).toBe(total)
    expect(newestPage.entries.at(0)?.message).toBe(`entry-${total - DEFAULTS.LOGS.MAX_PAGE_SIZE}`)
    expect(newestPage.entries.at(-1)?.message).toBe(`entry-${total - 1}`)

    const retainedCount = newestPage.latestSeq - newestPage.oldestSeq + 1
    expect(retainedCount).toBe(DEFAULTS.LOGS.BUFFER_CAPACITY)
  })

  it('level filter keeps minimum severity: warn returns warn and error only', () => {
    appendManagerLogEntry({ level: 'debug', source: 'manager', message: 'debug' })
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'info' })
    appendManagerLogEntry({ level: 'warn', source: 'manager', message: 'warn' })
    appendManagerLogEntry({ level: 'error', source: 'manager', message: 'error' })

    const result = readManagerLogEntries({ level: 'warn' })
    expect(result.entries.map((entry) => entry.level)).toEqual(['warn', 'error'])
  })

  it('source filter excludes other sources', () => {
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'from manager' })
    appendManagerLogEntry({ level: 'info', source: 'opencode', message: 'from opencode' })

    const result = readManagerLogEntries({ source: 'opencode' })
    expect(result.entries.map((entry) => entry.message)).toEqual(['from opencode'])
  })

  it('limit above MAX_PAGE_SIZE is capped to MAX_PAGE_SIZE newest matches', () => {
    const total = DEFAULTS.LOGS.MAX_PAGE_SIZE + 10
    for (let i = 0; i < total; i++) {
      appendManagerLogEntry({ level: 'info', source: 'manager', message: `entry-${i}` })
    }

    const result = readManagerLogEntries({ limit: DEFAULTS.LOGS.MAX_PAGE_SIZE * 10 })
    expect(result.entries).toHaveLength(DEFAULTS.LOGS.MAX_PAGE_SIZE)
    expect(result.entries.at(0)?.message).toBe(`entry-${total - DEFAULTS.LOGS.MAX_PAGE_SIZE}`)
    expect(result.entries.at(-1)?.message).toBe(`entry-${total - 1}`)
  })

  it('truncates messages longer than MAX_ENTRY_LENGTH with the truncated marker', () => {
    const longMessage = 'x'.repeat(DEFAULTS.LOGS.MAX_ENTRY_LENGTH + 100)
    appendManagerLogEntry({ level: 'info', source: 'manager', message: longMessage })

    const result = readManagerLogEntries({})
    expect(result.entries).toHaveLength(1)
    const storedMessage = result.entries.at(0)?.message
    expect(storedMessage?.endsWith(' …[truncated]')).toBe(true)
    expect(storedMessage?.length).toBe(DEFAULTS.LOGS.MAX_ENTRY_LENGTH + ' …[truncated]'.length)
  })
})

describe('process log forwarder', () => {
  beforeEach(() => {
    resetManagerLogBuffer()
  })

  it('emits one entry per complete line and nothing for a trailing partial line', () => {
    const forwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    forwarder.write('first\nsecond\npartial')

    expect(readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)).toEqual([
      'first',
      'second',
    ])

    forwarder.write('\n')
    expect(readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)).toEqual([
      'first',
      'second',
      'partial',
    ])
  })

  it('joins a line split across two writes and emits it once', () => {
    const forwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    forwarder.write('hel')
    forwarder.write('lo\n')

    expect(readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)).toEqual(['hello'])
  })

  it('flush emits a trailing partial line', () => {
    const forwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    forwarder.write('tail without newline')
    forwarder.flush()

    expect(readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)).toEqual([
      'tail without newline',
    ])
  })

  it('skips blank and whitespace-only lines', () => {
    const forwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    forwarder.write('\n   \n\t\nreal line\n')

    expect(readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)).toEqual(['real line'])
  })

  it('preserves trailing spaces and tabs on nonblank lines', () => {
    const forwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    forwarder.write('formatted value:   \n\taligned diagnostic\t\n')

    expect(readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)).toEqual([
      'formatted value:   ',
      '\taligned diagnostic\t',
    ])
  })

  it('parses embedded levels and falls back to the forwarder default', () => {
    const stdoutForwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    const stderrForwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'error' })

    stdoutForwarder.write('ERROR boom\n')
    stderrForwarder.write('INFO fine\n')
    stderrForwarder.write('no level token here\n')

    expect(readManagerLogEntries({ source: 'opencode' }).entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'ERROR boom', level: 'error', source: 'opencode' }),
        expect.objectContaining({ message: 'INFO fine', level: 'info', source: 'opencode' }),
        expect.objectContaining({ message: 'no level token here', level: 'error', source: 'opencode' }),
      ]),
    )
  })

  it('carries the configured source on every entry', () => {
    const forwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    forwarder.write('one\ntwo\n')

    const result = readManagerLogEntries({ source: 'opencode' })
    expect(result.entries).toHaveLength(2)
    expect(result.entries.every((entry) => entry.source === 'opencode')).toBe(true)
  })

  it('appends an endless unterminated line once it exceeds MAX_ENTRY_LENGTH instead of growing unbounded', () => {
    const forwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    forwarder.write('a'.repeat(DEFAULTS.LOGS.MAX_ENTRY_LENGTH + 1))
    expect(readManagerLogEntries({ source: 'opencode' }).entries).toHaveLength(1)

    forwarder.write('b'.repeat(10))
    forwarder.flush()

    const entries = readManagerLogEntries({ source: 'opencode' }).entries
    expect(entries).toHaveLength(2)
    expect(entries[0]?.message.startsWith('a')).toBe(true)
    expect(entries[1]?.message.startsWith('b')).toBe(true)
  })

  it('rejoins a multibyte UTF-8 character whose bytes are split across two writes', () => {
    const forwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    const bytes = new TextEncoder().encode('opencode log: 😀 done\n')
    forwarder.write(bytes.slice(0, 16))
    forwarder.write(bytes.slice(16))

    expect(readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)).toEqual([
      'opencode log: 😀 done',
    ])
  })

  it('flush finalizes a trailing incomplete UTF-8 sequence instead of losing it', () => {
    const forwarder = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    const bytes = new TextEncoder().encode('warn: café')
    forwarder.write(bytes.slice(0, bytes.length - 1))
    forwarder.flush()

    expect(readManagerLogEntries({ source: 'opencode' }).entries.map((entry) => entry.message)).toEqual([
      'warn: caf\uFFFD',
    ])
  })

  it('returns the same instanceId on every read and ignores buffer resets', () => {
    const first = readManagerLogEntries({})
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'after reset' })
    resetManagerLogBuffer()
    appendManagerLogEntry({ level: 'info', source: 'manager', message: 'after reset' })
    const second = readManagerLogEntries({})

    expect(first.instanceId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(second.instanceId).toBe(first.instanceId)
  })
})
