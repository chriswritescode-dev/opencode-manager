import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { OpenCodeLifecycleStatus } from '@opencode-manager/shared/opencode'
import { useOpenCodeFailureToast } from './useOpenCodeFailureToast'
import { renderHookWithProviders } from '@/test/render'
import { makeHealthResponse } from '@/test/fixtures/api'

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

function healthFor(status: OpenCodeLifecycleStatus) {
  return makeHealthResponse({
    status: status.healthy ? 'healthy' : 'unhealthy',
    opencode: status.healthy ? 'healthy' : 'unhealthy',
    opencodeLifecycle: status,
  })
}

function useFailureToastHost(enabled: boolean, onRestart: () => void) {
  useOpenCodeFailureToast(enabled, onRestart)
  return useLocation()
}

function renderFailureToast(initialHealth: ReturnType<typeof healthFor>) {
  const onRestart = vi.fn()
  let health = initialHealth
  const rendered = renderHookWithProviders(() => useFailureToastHost(true, onRestart), {
    ...hookProviders,
    fetchRoutes: [{ method: 'GET', path: '/api/health', respond: () => ({ json: health }) }],
  })
  const applyHealth = async (next: ReturnType<typeof healthFor>) => {
    health = next
    await act(async () => {
      await rendered.queryClient.invalidateQueries({ queryKey: ['health'] })
    })
  }
  return { ...rendered, onRestart, applyHealth }
}

describe('useOpenCodeFailureToast', () => {
  it('raises one persistent toast per distinct failure, including when the app loads already failed', async () => {
    const harness = renderFailureToast(
      healthFor(lifecycle({ state: 'failed', healthy: false, lastError: 'OpenCode server exited with code 1' })),
    )

    expect(await screen.findByText('OpenCode server failed')).toBeInTheDocument()
    expect(screen.getByText('OpenCode server exited with code 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View logs' }))
    await waitFor(() => expect(harness.result.current.search).toContain('settingsTab=logs'))

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(harness.onRestart).toHaveBeenCalledTimes(1)

    harness.rerender()
    expect(screen.getAllByText('OpenCode server failed')).toHaveLength(1)

    await harness.applyHealth(
      healthFor(lifecycle({ state: 'failed', healthy: false, lastError: 'Unsupported OpenCode version' })),
    )

    expect(await screen.findByText('Unsupported OpenCode version')).toBeInTheDocument()
    expect(screen.getAllByText('OpenCode server failed')).toHaveLength(1)
  })

  it('does not toast while recovery is still in progress', async () => {
    const { fetchFake } = renderFailureToast(
      healthFor(lifecycle({ state: 'recovering', healthy: false, lastError: 'health check failed' })),
    )

    await waitFor(() => expect(fetchFake.findRequests('GET', '/api/health')).toHaveLength(1))
    expect(screen.queryByText('OpenCode server failed')).toBeNull()
  })

  it('dismisses the failure and announces recovery only once the server is healthy again', async () => {
    const harness = renderFailureToast(healthFor(lifecycle({ state: 'failed', healthy: false, lastError: 'boom' })))

    expect(await screen.findByText('OpenCode server failed')).toBeInTheDocument()

    await harness.applyHealth(healthFor(lifecycle({ state: 'starting', healthy: false })))
    expect(screen.queryByText('OpenCode server is back online')).toBeNull()

    await harness.applyHealth(healthFor(lifecycle({ state: 'healthy', healthy: true })))

    expect(await screen.findByText('OpenCode server is back online')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('OpenCode server failed')).toBeNull())
  })
})
