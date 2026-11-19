import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { AssistantRedirect } from '../AssistantRedirect'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { makeRepo } from '@/test/fixtures/api'
import { installMatchMedia } from '@/test/browserFakes'
import type { FetchRoute } from '@/test/fetchFake'

const assistantRepo = makeRepo({ id: 0, name: 'Assistant', fullPath: '/abs/assistant' })

const terminalsResponse = {
  terminals: [
    { id: 't1', title: 'Terminal', kind: 'shell', cwd: '/abs/assistant', status: 'running' },
  ],
}

const previewPortsResponse = {
  enabled: true,
  ports: [
    {
      port: 5173,
      host: '127.0.0.1',
      pid: 10,
      command: 'vite',
      cwd: '/abs/assistant',
      inDirectory: true,
    },
  ],
}

function buildRoutes(): FetchRoute[] {
  return [
    { method: 'GET', path: '/api/repos/0', respond: () => ({ json: assistantRepo }) },
    { method: 'GET', path: '/api/repos/0/terminals', respond: () => ({ json: terminalsResponse }) },
    { method: 'GET', path: '/api/preview/ports', respond: () => ({ json: previewPortsResponse }) },
    {
      method: 'POST',
      path: '/api/preview/sessions',
      respond: () => ({ json: { token: 'tok', previewPort: 5004, publicUrl: null } }),
    },
    { method: 'GET', path: '/api/session-pins', respond: () => ({ json: { pins: [] } }) },
    { method: 'GET', path: '/api/opencode/api/session', respond: () => ({ json: { data: [], cursor: {} } }) },
    { method: 'GET', path: '/api/schedules/all/runs/unread', respond: () => ({ json: { runs: [], total: 0, failed: 0 } }) },
  ]
}

function renderAssistantRedirect(route: string) {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <Routes>
        <Route path="/assistant" element={<AssistantRedirect />} />
      </Routes>
    </>,
    {
      route,
      events: true,
      tts: true,
      fetchRoutes: buildRoutes(),
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

describe('AssistantRedirect preview routing', () => {
  beforeEach(() => {
    installMatchMedia(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 780 })
  })

  it('opens the preview panel for a local terminal link', async () => {
    const { fetchFake, capturedSearch } = renderAssistantRedirect(
      '/assistant?dialog=preview&panel=preview&previewPort=5173&previewPath=%2Fdashboard',
    )

    const iframe = await waitFor(() => {
      const element = document.querySelector('iframe[title="Preview"]')
      expect(element).not.toBeNull()
      return element
    })

    const src = iframe?.getAttribute('src') ?? ''
    expect(src).toContain('token=tok')
    expect(src).toContain('path=%2Fdashboard')
    expect(fetchFake.lastRequest('POST', '/api/preview/sessions')?.body).toEqual({ port: 5173 })
    expect(capturedSearch.current).toContain('panel=preview')
    expect(document.querySelector('.xterm')).toBeNull()
  })

  it('keeps the terminal panel when an external link does not request a preview', async () => {
    const openSpy = vi.spyOn(window, 'open')
    const { fetchFake } = renderAssistantRedirect('/assistant?dialog=terminal&panel=terminal')

    const terminalDialog = await screen.findByRole('dialog')
    expect(await within(terminalDialog).findByText('Terminal')).toBeInTheDocument()
    expect(document.querySelector('iframe[title="Preview"]')).toBeNull()
    expect(fetchFake.findRequests('POST', '/api/preview/sessions')).toHaveLength(0)
    expect(openSpy).not.toHaveBeenCalled()
  })
})
