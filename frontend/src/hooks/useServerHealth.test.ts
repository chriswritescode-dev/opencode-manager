import { describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { OpenCodeLifecycleStatus } from '@opencode-manager/shared/opencode'
import { makeHealthResponse } from '@/test/fixtures/api'
import { renderHookWithProviders } from '@/test/render'
import { getOpenCodeServerIssue, useServerHealth } from './useServerHealth'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

function lifecycle(overrides: Partial<OpenCodeLifecycleStatus>): OpenCodeLifecycleStatus {
  return {
    state: 'healthy',
    healthy: true,
    port: 5551,
    version: '2.0.15',
    minVersion: '2.0.15',
    versionSupported: true,
    lastError: null,
    activeRecoveryAction: null,
    attemptedRecoveryActions: [],
    nextRecoveryAction: null,
    failureCount: 0,
    watching: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('useServerHealth', () => {
  it('reports the outage when the health endpoint responds 503 with the full unhealthy body', async () => {
    const outageBody = makeHealthResponse({
      status: 'unhealthy',
      database: 'disconnected',
      opencode: 'unhealthy',
      opencodeVersion: null,
      opencodeVersionSupported: false,
      opencodeManagerVersion: null,
      error: 'Database ping failed',
    })
    const { result } = renderHookWithProviders(() => useServerHealth(), {
      ...hookProviders,
      fetchRoutes: [
        { method: 'GET', path: '/api/health', respond: () => ({ status: 503, json: outageBody }) },
      ],
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(getOpenCodeServerIssue(result.current.data)).toEqual({
      state: 'failed',
      message: 'Database ping failed',
      attemptedRecoveryActions: [],
    })
  })

  it('reports an un-started supervisor (idle) as an outage while OpenCode is unhealthy', () => {
    const health = makeHealthResponse({
      status: 'degraded',
      opencode: 'unhealthy',
      opencodeLifecycle: lifecycle({ state: 'idle', healthy: false }),
    })

    expect(getOpenCodeServerIssue(health)).toEqual({
      state: 'unhealthy',
      message: 'OpenCode server is not responding',
      attemptedRecoveryActions: [],
    })
  })
})
