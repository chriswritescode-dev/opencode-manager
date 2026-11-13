import { describe, it, expect } from 'vitest'
import { formatBytes, createProgressReporter } from '../src/progress'
import type { ProgressSink } from '../src/progress'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [500, '500 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1_048_576, '1.0 MB'],
    [13_000_000, '12.4 MB'],
    [1_073_741_824, '1.0 GB'],
    [1_500_000_000, '1.4 GB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('createProgressReporter', () => {
  function createSink(isTTY: boolean) {
    const writes: string[] = []
    const sink: ProgressSink = {
      write(chunk: string) {
        writes.push(chunk)
      },
      isTTY,
    }
    return { sink, writes }
  }

  describe('TTY tick', () => {
    it('output begins with carriage return and clear line and uses spinner frames', () => {
      let fakeTime = 100_000
      const now = () => fakeTime
      const { sink, writes } = createSink(true)
      const reporter = createProgressReporter('Test', sink, now)

      reporter.tick(500)
      expect(writes).toHaveLength(1)
      expect(writes[0]).toMatch(/^\r\x1b\[K/)
      expect(writes[0]).toContain('⠋')
      expect(writes[0]).toContain('500 B')

      fakeTime += 100
      reporter.tick(1024)
      expect(writes).toHaveLength(2)
      expect(writes[1]).toContain('⠙')
      expect(writes[1]).toContain('1.0 KB')
    })

    it('throttles renders to at least 80ms apart', () => {
      let fakeTime = 100_000
      const now = () => fakeTime
      const { sink, writes } = createSink(true)
      const reporter = createProgressReporter('Test', sink, now)

      reporter.tick(100)
      expect(writes).toHaveLength(1)

      fakeTime += 40
      reporter.tick(200)
      expect(writes).toHaveLength(1)

      fakeTime += 40
      reporter.tick(300)
      expect(writes).toHaveLength(2)
    })

    it('wraps spinner frames and never renders undefined after 10+ throttled ticks', () => {
      let fakeTime = 100_000
      const now = () => fakeTime
      const { sink, writes } = createSink(true)
      const reporter = createProgressReporter('Test', sink, now)

      for (let i = 0; i < 12; i++) {
        reporter.tick(i * 100)
        fakeTime += 100
      }

      expect(writes).toHaveLength(12)
      for (const w of writes) {
        expect(w).not.toContain('undefined')
      }
      expect(writes[10]).toContain('⠋')
      expect(writes[11]).toContain('⠙')
    })
  })

  describe('non-TTY tick', () => {
    it('writes a line at most once per 1000ms', () => {
      let fakeTime = 100_000
      const now = () => fakeTime
      const { sink, writes } = createSink(false)
      const reporter = createProgressReporter('Test', sink, now)

      reporter.tick(500)
      expect(writes).toHaveLength(1)
      expect(writes[0]).toBe('Test: 500 B\n')

      fakeTime += 500
      reporter.tick(1024)
      expect(writes).toHaveLength(1)

      fakeTime += 500
      reporter.tick(2048)
      expect(writes).toHaveLength(2)
      expect(writes[1]).toBe('Test: 2.0 KB\n')
    })
  })

  describe('done()', () => {
    it('clears the progress line on TTY', () => {
      const { sink, writes } = createSink(true)
      const reporter = createProgressReporter('Test', sink)

      reporter.done()
      expect(writes).toHaveLength(1)
      expect(writes[0]).toBe('\r\x1b[K')
    })

    it('is a no-op on non-TTY', () => {
      const { sink, writes } = createSink(false)
      const reporter = createProgressReporter('Test', sink)

      reporter.done()
      expect(writes).toHaveLength(0)
    })

    it('is idempotent — calling done() twice on TTY only writes once', () => {
      const { sink, writes } = createSink(true)
      const reporter = createProgressReporter('Test', sink)

      reporter.done()
      reporter.done()
      expect(writes).toHaveLength(1)
    })
  })

  describe('finished guard', () => {
    it('tick is a no-op after done()', () => {
      const fakeTime = 100_000
      const now = () => fakeTime
      const { sink, writes } = createSink(true)
      const reporter = createProgressReporter('Test', sink, now)

      reporter.done()
      const before = writes.length

      reporter.tick(999)
      expect(writes.length).toBe(before)
    })
  })
})
