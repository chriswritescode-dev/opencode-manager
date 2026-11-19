import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ServerHealthStatus } from './ServerHealthStatus'
import { renderWithProviders } from '@/test/render'
import { makeHealthResponse } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { HealthResponse } from '@/hooks/useServerHealth'

interface HealthRenderOptions {
  health?: Partial<HealthResponse>
  activeSessions?: number
}

function renderHealthStatus(options: HealthRenderOptions = {}) {
  const fetchRoutes: FetchRoute[] = [
    { method: 'GET', path: '/api/health', respond: () => ({ json: makeHealthResponse({ opencode: 'healthy', opencodeVersion: '1.18.16', ...options.health }) }) },
    {
      method: 'POST',
      path: '/api/settings/opencode-upgrade',
      respond: () => ({ json: { success: true, message: 'Upgraded', upgraded: true, newVersion: '1.19.0' } }),
    },
    {
      method: 'GET',
      path: '/api/settings/opencode-active-sessions',
      respond: () => ({ json: { count: options.activeSessions ?? 0, sessions: [] } }),
    },
    {
      method: 'POST',
      path: '/api/settings/opencode-restart',
      respond: () => ({ json: { success: true, message: 'Server restarted' } }),
    },
  ]
  const result = renderWithProviders(<ServerHealthStatus />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
  return result
}

describe('ServerHealthStatus', () => {
  it('keeps Update, Restart, and Versions enabled once health is reported', async () => {
    renderHealthStatus()

    expect(await screen.findByText('Server Status: Healthy')).toBeInTheDocument()
    expect(screen.getByText('OpenCode v1.18.16')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Update/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Restart/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Versions/i })).toBeEnabled()
  })

  it('reports an unhealthy server with its error', async () => {
    renderHealthStatus({ health: { opencode: 'unhealthy', error: 'connection refused' } })

    expect(await screen.findByText('Server Status: Unhealthy')).toBeInTheDocument()
    expect(screen.getByText('connection refused')).toBeInTheDocument()
  })

  it('upgrades OpenCode when Update is clicked', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderHealthStatus()

    await user.click(await screen.findByRole('button', { name: /Update/i }))

    expect(fetchFake.findRequests('POST', '/api/settings/opencode-upgrade')).toHaveLength(1)
    expect(await screen.findByText('Upgraded to v1.19.0 and server restarted')).toBeInTheDocument()
  })

  it('restarts immediately when no session is working', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderHealthStatus()

    await user.click(await screen.findByRole('button', { name: /Restart/i }))

    expect(fetchFake.findRequests('POST', '/api/settings/opencode-restart')).toHaveLength(1)
    expect(await screen.findByText('Server restarted successfully')).toBeInTheDocument()
  })

  it('asks for confirmation before interrupting working sessions', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderHealthStatus({ activeSessions: 2 })

    await user.click(await screen.findByRole('button', { name: /Restart/i }))

    expect(await screen.findByText(/2 sessions are currently working/)).toBeInTheDocument()
    expect(fetchFake.findRequests('POST', '/api/settings/opencode-restart')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Restart now' }))

    expect(fetchFake.findRequests('POST', '/api/settings/opencode-restart')).toHaveLength(1)
  })

  it('opens the version dialog when Versions is clicked', async () => {
    const user = userEvent.setup()
    const onOpenVersionDialog = vi.fn()
    renderWithProviders(<ServerHealthStatus onOpenVersionDialog={onOpenVersionDialog} />, {
      auth: false,
      theme: false,
      tts: false,
      fetchRoutes: [
        { method: 'GET', path: '/api/health', respond: () => ({ json: makeHealthResponse({ opencode: 'healthy' }) }) },
      ],
    })

    await user.click(await screen.findByRole('button', { name: /Versions/i }))

    expect(onOpenVersionDialog).toHaveBeenCalledTimes(1)
  })
})
