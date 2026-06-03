import { describe, it, expect } from 'vitest'
import { formatBytes, createProgressReporter } from '../src/progress'
import type { ProgressSink } from '../src/progress'

describe('formatBytes', () => {
  it('returns "0 B" for 0', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats values below 1024 as whole bytes', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats values at 1024 as KB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats values at 1 MB as MB with one decimal', () => {
    expect(formatBytes(1_048_576)).toBe('1.0 MB')
    expect(formatBytes(13_000_000)).toBe('12.4 MB')
  })

  it('formats values at 1 GB as GB with one decimal', () => {
    expect(formatBytes(1_073_741_824)).toBe('1.0 GB')
    expect(formatBytes(1_500_000_000)).toBe('1.4 GB')
  })
})

describe('createProgressReporter', () => {
  function createSink(isTTY: boolean): { sink: ProgressSink; writes: string[] } {
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

      // First tick at t=100000
      reporter.tick(500)
      expect(writes).toHaveLength(1)
      expect(writes[0]).toMatch(/^\r\x1b\[K/)
      // First frame is '⠋'
      expect(writes[0]).toContain('⠋')
      expect(writes[0]).toContain('500 B')

      // Advance time past throttle window
      fakeTime += 100
      reporter.tick(1024)
      expect(writes).toHaveLength(2)
      // Second frame is '⠙'
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

      // Render 12 ticks, each 100ms apart (past the 80ms throttle)
      for (let i = 0; i < 12; i++) {
        reporter.tick(i * 100)
        fakeTime += 100
      }

      expect(writes).toHaveLength(12)
      // No write should contain "undefined"
      for (const w of writes) {
        expect(w).not.toContain('undefined')
      }
      // After 10 frames, the 11th write cycles back to the first frame '⠋'
      // writes[10] is the 11th rendered tick → frameIndex = (0 + 10) % 10 = 0 → '⠋'
      expect(writes[10]).toContain('⠋')
      // writes[11] is the 12th rendered tick → frameIndex = (0 + 11) % 10 = 1 → '⠙'
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

      // Too soon
      fakeTime += 500
      reporter.tick(1024)
      expect(writes).toHaveLength(1)

      // After 1000ms total
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
      let fakeTime = 100_000
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
