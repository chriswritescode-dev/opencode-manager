import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sseManager, SSEHealthState } from '../sseManager'

describe('SSEManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('markActivity', () => {
    it('should update lastEventAt when activity occurs', () => {
      const health = sseManager.getHealth()
      const initialTime = health.lastEventAt
      
      const mockEventSource = {
        onopen: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onmessage: null as ((event: MessageEvent) => void) | null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        readyState: 1,
      }
      
      const originalEventSource = global.EventSource
      global.EventSource = vi.fn(() => mockEventSource) as any
      
      sseManager.reconnect()
      
      if (mockEventSource.onopen) {
        mockEventSource.onopen(new Event('open'))
      }
      
      const healthAfter = sseManager.getHealth()
      expect(healthAfter.lastEventAt).not.toBeNull()
      expect(healthAfter.lastEventAt).toBeGreaterThan(initialTime || 0)
      
      global.EventSource = originalEventSource
    })
  })

  describe('watchdog stall', () => {
    it('should trip after 90s of inactivity', async () => {
      const mockEventSource = {
        onopen: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onmessage: null as ((event: MessageEvent) => void) | null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        readyState: 1,
      }
      
      const originalEventSource = global.EventSource
      global.EventSource = vi.fn(() => mockEventSource) as any
      
      sseManager.reconnect()
      
      if (mockEventSource.onopen) {
        mockEventSource.onopen(new Event('open'))
      }
      
      const initialHealth = sseManager.getHealth()
      expect(initialHealth.isHealthy).toBe(true)
      expect(initialHealth.isStalled).toBe(false)
      
      await vi.advanceTimersByTimeAsync(90000)
      
      expect(mockEventSource.close).toHaveBeenCalled()
      
      global.EventSource = originalEventSource
    })
  })

  describe('connected event', () => {
    it('should reset health to healthy on connected event', () => {
      const mockEventSource = {
        onopen: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onmessage: null as ((event: MessageEvent) => void) | null,
        addEventListener: vi.fn((event: string, handler: EventListener) => {
          if (event === 'connected') {
            setTimeout(() => {
              handler(new MessageEvent('connected', { data: JSON.stringify({ clientId: 'test' }) }))
            }, 0)
          }
        }),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        readyState: 1,
      }
      
      const originalEventSource = global.EventSource
      global.EventSource = vi.fn(() => mockEventSource) as any
      
      sseManager.reconnect()
      
      vi.advanceTimersByTime(100)
      
      const health = sseManager.getHealth()
      expect(health.isConnected).toBe(true)
      expect(health.isHealthy).toBe(true)
      expect(health.isStalled).toBe(false)
      
      global.EventSource = originalEventSource
    })
  })

  describe('subscribeHealth', () => {
    it('should return unsubscribe function and stop receiving updates', () => {
      const listener = vi.fn()
      
      const unsubscribe = sseManager.subscribeHealth(listener)
      
      expect(listener).toHaveBeenCalledTimes(1)
      
      unsubscribe()
      
      const mockEventSource = {
        onopen: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onmessage: null as ((event: MessageEvent) => void) | null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        readyState: 1,
      }
      
      const originalEventSource = global.EventSource
      global.EventSource = vi.fn(() => mockEventSource) as any
      
      sseManager.reconnect()
      
      if (mockEventSource.onopen) {
        mockEventSource.onopen(new Event('open'))
      }
      
      expect(listener).toHaveBeenCalledTimes(1)
      
      global.EventSource = originalEventSource
    })
  })

  describe('SSEHealthState', () => {
    it('should have correct interface', () => {
      const health: SSEHealthState = {
        isConnected: true,
        isHealthy: true,
        lastEventAt: Date.now(),
        isStalled: false,
      }
      
      expect(health.isConnected).toBeDefined()
      expect(health.isHealthy).toBeDefined()
      expect(health.lastEventAt).toBeDefined()
      expect(health.isStalled).toBeDefined()
    })
  })
})
