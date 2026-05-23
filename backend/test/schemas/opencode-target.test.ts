import { describe, it, expect } from 'vitest'
import {
  OpenCodeTargetStateSchema,
  OpenCodeTargetSchema,
  EnsureOpenCodeTargetRequestSchema,
  EnsureOpenCodeTargetResponseSchema,
  SyncRepoSessionRequestSchema,
  SyncRepoSessionResponseSchema,
} from '@opencode-manager/shared'

describe('OpenCodeTarget schemas', () => {
  describe('OpenCodeTargetStateSchema', () => {
    it('should accept valid target states', () => {
      const validStates = ['missing', 'starting', 'healthy', 'unhealthy', 'failed', 'stopped']
      for (const state of validStates) {
        expect(OpenCodeTargetStateSchema.parse(state)).toBe(state)
      }
    })

    it('should reject invalid states', () => {
      expect(() => OpenCodeTargetStateSchema.parse('unknown')).toThrow()
      expect(() => OpenCodeTargetStateSchema.parse('')).toThrow()
      expect(() => OpenCodeTargetStateSchema.parse(123)).toThrow()
    })
  })

  describe('OpenCodeTargetSchema', () => {
    it('should accept a valid target with all fields', () => {
      const valid = {
        repoId: 1,
        state: 'healthy',
        openCodeUrl: 'http://localhost:5551',
        token: 'test-token',
        startedAt: Date.now(),
        lastUsedAt: Date.now(),
        lastError: 'some error',
        reused: false,
      }
      expect(OpenCodeTargetSchema.parse(valid)).toEqual(valid)
    })

    it('should accept a minimal target with required fields only', () => {
      const minimal = {
        repoId: 1,
        state: 'missing',
        reused: false,
      }
      expect(OpenCodeTargetSchema.parse(minimal)).toEqual(minimal)
    })

    it('should reject a target missing required fields', () => {
      expect(() => OpenCodeTargetSchema.parse({})).toThrow()
      expect(() => OpenCodeTargetSchema.parse({ repoId: 1 })).toThrow()
      expect(() => OpenCodeTargetSchema.parse({ state: 'healthy' })).toThrow()
    })

    it('should reject invalid repoId types', () => {
      expect(() =>
        OpenCodeTargetSchema.parse({ repoId: 'abc', state: 'healthy', reused: false })
      ).toThrow()
    })

    it('should reject invalid state', () => {
      expect(() =>
        OpenCodeTargetSchema.parse({ repoId: 1, state: 'invalid', reused: false })
      ).toThrow()
    })

    it('should reject invalid reused type', () => {
      expect(() =>
        OpenCodeTargetSchema.parse({ repoId: 1, state: 'healthy', reused: 'yes' })
      ).toThrow()
    })
  })

  describe('EnsureOpenCodeTargetRequestSchema', () => {
    it('should accept empty request (all optional)', () => {
      expect(EnsureOpenCodeTargetRequestSchema.parse({})).toEqual({})
    })

    it('should accept request with workspaceId', () => {
      expect(EnsureOpenCodeTargetRequestSchema.parse({ workspaceId: 'ws-1' })).toEqual({
        workspaceId: 'ws-1',
      })
    })

    it('should accept request with clientId', () => {
      expect(EnsureOpenCodeTargetRequestSchema.parse({ clientId: 'client-1' })).toEqual({
        clientId: 'client-1',
      })
    })

    it('should accept request with both fields', () => {
      expect(
        EnsureOpenCodeTargetRequestSchema.parse({ workspaceId: 'ws-1', clientId: 'client-1' })
      ).toEqual({ workspaceId: 'ws-1', clientId: 'client-1' })
    })
  })

  describe('EnsureOpenCodeTargetResponseSchema', () => {
    it('should accept a valid response', () => {
      const valid = {
        repoId: 1,
        state: 'healthy',
        openCodeUrl: 'http://localhost:5551',
        headers: { Authorization: 'Bearer test-token' },
        reused: true,
      }
      expect(EnsureOpenCodeTargetResponseSchema.parse(valid)).toEqual(valid)
    })

    it('should reject missing required fields', () => {
      expect(() =>
        EnsureOpenCodeTargetResponseSchema.parse({ repoId: 1, state: 'healthy' })
      ).toThrow()
      expect(() =>
        EnsureOpenCodeTargetResponseSchema.parse({
          repoId: 1,
          state: 'healthy',
          openCodeUrl: 'http://localhost:5551',
        })
      ).toThrow()
    })

    it('should reject invalid state', () => {
      expect(() =>
        EnsureOpenCodeTargetResponseSchema.parse({
          repoId: 1,
          state: 'invalid',
          openCodeUrl: 'http://localhost:5551',
          headers: {},
          reused: false,
        })
      ).toThrow()
    })
  })

  describe('SyncRepoSessionRequestSchema', () => {
    it('should accept a valid sync request', () => {
      expect(
        SyncRepoSessionRequestSchema.parse({ sessionId: 'session-1', reason: 'idle' })
      ).toEqual({ sessionId: 'session-1', reason: 'idle' })
    })

    it('should accept all valid reasons', () => {
      const validReasons = ['idle', 'completed', 'stop', 'manual']
      for (const reason of validReasons) {
        expect(
          SyncRepoSessionRequestSchema.parse({ sessionId: 'session-1', reason })
        ).toEqual({ sessionId: 'session-1', reason })
      }
    })

    it('should reject invalid reasons', () => {
      expect(() =>
        SyncRepoSessionRequestSchema.parse({ sessionId: 'session-1', reason: 'invalid' })
      ).toThrow()
      expect(() =>
        SyncRepoSessionRequestSchema.parse({ sessionId: 'session-1', reason: '' })
      ).toThrow()
    })

    it('should reject missing sessionId', () => {
      expect(() =>
        SyncRepoSessionRequestSchema.parse({ reason: 'idle' })
      ).toThrow()
    })

    it('should reject missing reason', () => {
      expect(() =>
        SyncRepoSessionRequestSchema.parse({ sessionId: 'session-1' })
      ).toThrow()
    })
  })

  describe('SyncRepoSessionResponseSchema', () => {
    it('should accept a valid response', () => {
      expect(
        SyncRepoSessionResponseSchema.parse({
          repoId: 1,
          sessionId: 'session-1',
          replayedEvents: 5,
        })
      ).toEqual({ repoId: 1, sessionId: 'session-1', replayedEvents: 5 })
    })

    it('should reject missing required fields', () => {
      expect(() =>
        SyncRepoSessionResponseSchema.parse({ repoId: 1 })
      ).toThrow()
      expect(() =>
        SyncRepoSessionResponseSchema.parse({ sessionId: 'session-1' })
      ).toThrow()
      expect(() =>
        SyncRepoSessionResponseSchema.parse({ replayedEvents: 0 })
      ).toThrow()
    })

    it('should reject invalid types', () => {
      expect(() =>
        SyncRepoSessionResponseSchema.parse({
          repoId: 'abc',
          sessionId: 'session-1',
          replayedEvents: 5,
        })
      ).toThrow()
      expect(() =>
        SyncRepoSessionResponseSchema.parse({
          repoId: 1,
          sessionId: 'session-1',
          replayedEvents: 'five',
        })
      ).toThrow()
    })
  })
})
