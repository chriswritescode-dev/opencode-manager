import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notificationEvents, type NotificationEventType } from './notificationEvents'

describe('notificationEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('subscribe', () => {
    it('should add a listener and call it when event is emitted', () => {
      const listener = vi.fn()
      
      notificationEvents.subscribe(listener)
      notificationEvents.emit({ type: 'session-complete', sessionId: 'test-123' })

      expect(listener).toHaveBeenCalledWith({ type: 'session-complete', sessionId: 'test-123' })
    })

    it('should support multiple listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      
      notificationEvents.subscribe(listener1)
      notificationEvents.subscribe(listener2)
      notificationEvents.emit({ type: 'session-complete', sessionId: 'test-123' })

      expect(listener1).toHaveBeenCalledWith({ type: 'session-complete', sessionId: 'test-123' })
      expect(listener2).toHaveBeenCalledWith({ type: 'session-complete', sessionId: 'test-123' })
    })

    it('should return unsubscribe function', () => {
      const listener = vi.fn()
      
      const unsubscribe = notificationEvents.subscribe(listener)
      unsubscribe()
      notificationEvents.emit({ type: 'session-complete', sessionId: 'test-123' })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('emit', () => {
    it('should emit session-complete event with sessionId', () => {
      const listener = vi.fn()
      const unsubscribe = notificationEvents.subscribe(listener)

      notificationEvents.emit({ type: 'session-complete', sessionId: 'session-456' })

      expect(listener).toHaveBeenCalledWith({
        type: 'session-complete',
        sessionId: 'session-456',
      })

      unsubscribe()
    })

    it('should emit session-complete event with sessionTitle', () => {
      const listener = vi.fn()
      const unsubscribe = notificationEvents.subscribe(listener)

      notificationEvents.emit({ 
        type: 'session-complete', 
        sessionId: 'session-456',
        sessionTitle: 'My Test Session'
      })

      expect(listener).toHaveBeenCalledWith({
        type: 'session-complete',
        sessionId: 'session-456',
        sessionTitle: 'My Test Session',
      })

      unsubscribe()
    })

    it('should emit session-complete event with repoId', () => {
      const listener = vi.fn()
      const unsubscribe = notificationEvents.subscribe(listener)

      notificationEvents.emit({ 
        type: 'session-complete', 
        sessionId: 'session-456',
        repoId: '123',
        sessionTitle: 'My Test Session'
      })

      expect(listener).toHaveBeenCalledWith({
        type: 'session-complete',
        sessionId: 'session-456',
        repoId: '123',
        sessionTitle: 'My Test Session',
      })

      unsubscribe()
    })

    it('should emit permission-request event', () => {
      const listener = vi.fn()
      const unsubscribe = notificationEvents.subscribe(listener)

      notificationEvents.emit({ 
        type: 'permission-request', 
        sessionId: 'session-789',
        toolName: 'Write'
      })

      expect(listener).toHaveBeenCalledWith({
        type: 'permission-request',
        sessionId: 'session-789',
        toolName: 'Write',
      })

      unsubscribe()
    })

    it('should emit permission-request event with repoId', () => {
      const listener = vi.fn()
      const unsubscribe = notificationEvents.subscribe(listener)

      notificationEvents.emit({ 
        type: 'permission-request', 
        sessionId: 'session-789',
        repoId: '456',
        toolName: 'Write'
      })

      expect(listener).toHaveBeenCalledWith({
        type: 'permission-request',
        sessionId: 'session-789',
        repoId: '456',
        toolName: 'Write',
      })

      unsubscribe()
    })

    it('should call all subscribed listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      const listener3 = vi.fn()

      const unsub1 = notificationEvents.subscribe(listener1)
      const unsub2 = notificationEvents.subscribe(listener2)
      const unsub3 = notificationEvents.subscribe(listener3)

      notificationEvents.emit({ type: 'session-complete', sessionId: 'test' })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
      expect(listener3).toHaveBeenCalledTimes(1)

      unsub1()
      unsub2()
      unsub3()
    })

    it('should not call unsubscribed listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const unsub1 = notificationEvents.subscribe(listener1)
      const unsub2 = notificationEvents.subscribe(listener2)

      unsub1()

      notificationEvents.emit({ type: 'session-complete', sessionId: 'test' })

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledTimes(1)

      unsub2()
    })
  })

  describe('unsubscribe behavior', () => {
    it('should handle multiple unsubscribes gracefully', () => {
      const listener = vi.fn()
      
      const unsubscribe = notificationEvents.subscribe(listener)
      unsubscribe()
      unsubscribe()
      unsubscribe()

      notificationEvents.emit({ type: 'session-complete', sessionId: 'test' })

      expect(listener).not.toHaveBeenCalled()
    })

    it('should not affect other listeners when one unsubscribes', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      const unsub1 = notificationEvents.subscribe(listener1)
      const unsub2 = notificationEvents.subscribe(listener2)

      unsub1()

      notificationEvents.emit({ type: 'permission-request', sessionId: 'test', toolName: 'Bash' })

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledWith({
        type: 'permission-request',
        sessionId: 'test',
        toolName: 'Bash',
      })

      unsub2()
    })
  })

  describe('type safety', () => {
    it('should handle session-complete event type', () => {
      const listener = vi.fn((event: NotificationEventType) => {
        if (event.type === 'session-complete') {
          expect(event.sessionId).toBeDefined()
        }
      })

      const unsubscribe = notificationEvents.subscribe(listener)
      notificationEvents.emit({ type: 'session-complete', sessionId: 'abc' })
      
      expect(listener).toHaveBeenCalled()
      unsubscribe()
    })

    it('should handle permission-request event type', () => {
      const listener = vi.fn((event: NotificationEventType) => {
        if (event.type === 'permission-request') {
          expect(event.sessionId).toBeDefined()
          expect(event.toolName).toBeDefined()
        }
      })

      const unsubscribe = notificationEvents.subscribe(listener)
      notificationEvents.emit({ type: 'permission-request', sessionId: 'abc', toolName: 'Read' })
      
      expect(listener).toHaveBeenCalled()
      unsubscribe()
    })
  })
})
