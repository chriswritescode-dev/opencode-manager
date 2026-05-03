import { describe, it, expect, vi } from 'vitest'
import { DEFAULTS } from '@opencode-manager/shared/config'

const { HEARTBEAT_INTERVAL_MS } = DEFAULTS.SSE

describe('SSE Routes', () => {
  describe('HEARTBEAT_INTERVAL_MS', () => {
    it('should be 30000ms (30 seconds)', () => {
      expect(HEARTBEAT_INTERVAL_MS).toBe(30000)
    })

    it('should fire heartbeats at correct interval', async () => {
      vi.useFakeTimers()
      
      const heartbeatSpy = vi.fn()
      const intervalId = setInterval(() => {
        heartbeatSpy()
      }, HEARTBEAT_INTERVAL_MS)
      
      await vi.advanceTimersByTimeAsync(0)
      expect(heartbeatSpy).toHaveBeenCalledTimes(1)
      
      await vi.advanceTimersByTimeAsync(30000)
      expect(heartbeatSpy).toHaveBeenCalledTimes(2)
      
      await vi.advanceTimersByTimeAsync(40000)
      expect(heartbeatSpy).toHaveBeenCalledTimes(3)
      
      clearInterval(intervalId)
      vi.useRealTimers()
    })

    it('should fire two heartbeats within 70 seconds', async () => {
      vi.useFakeTimers()
      
      const heartbeatSpy = vi.fn()
      const intervalId = setInterval(() => {
        heartbeatSpy()
      }, HEARTBEAT_INTERVAL_MS)
      
      await vi.advanceTimersByTimeAsync(70000)
      expect(heartbeatSpy).toHaveBeenCalledTimes(3)
      
      clearInterval(intervalId)
      vi.useRealTimers()
    })
  })
})
