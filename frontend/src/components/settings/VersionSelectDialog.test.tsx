import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionSelectDialog } from './VersionSelectDialog'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const releases = [
  { version: '2.1.0', tag: 'v2.1.0', name: '', publishedAt: '2026-01-01T00:00:00Z' },
  { version: '2.0.15', tag: 'v2.0.15', name: '', publishedAt: '2025-12-01T00:00:00Z' },
]

interface DialogRenderOptions {
  currentVersion?: string
  install?: () => FetchRouteResult | Promise<FetchRouteResult>
}

function renderDialog(options: DialogRenderOptions = {}) {
  const onOpenChange = vi.fn()
  const fetchRoutes: FetchRoute[] = [
    {
      method: 'GET',
      path: '/api/settings/opencode-versions',
      respond: () => ({ json: { versions: releases, currentVersion: options.currentVersion ?? '2.0.15' } }),
    },
    {
      method: 'POST',
      path: '/api/settings/opencode-install-version',
      respond: options.install ?? (() => ({
        json: { success: true, message: 'Installed OpenCode v2.1.0', newVersion: '2.1.0' },
      })),
    },
  ]
  const result = renderWithProviders(<VersionSelectDialog open onOpenChange={onOpenChange} />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
  return { ...result, onOpenChange }
}

describe('VersionSelectDialog', () => {
  it('lists versions and requires a selection before installing', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(await screen.findByRole('button', { name: /v2\.1\.0/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /v2\.0\.15/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Select version/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /v2\.1\.0/ }))

    expect(screen.getByRole('button', { name: /^Install$/i })).toBeEnabled()
  })

  it('installs the selected version and closes the dialog', async () => {
    const user = userEvent.setup()
    const { fetchFake, onOpenChange } = renderDialog({ currentVersion: '2.0.14' })

    await user.click(await screen.findByRole('button', { name: /v2\.1\.0/ }))
    await user.click(screen.getByRole('button', { name: /^Install$/i }))

    expect(fetchFake.lastRequest('POST', '/api/settings/opencode-install-version')?.body).toEqual({
      version: '2.1.0',
    })
    expect(await screen.findByText('Installed OpenCode v2.1.0')).toBeInTheDocument()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reports a failed install and keeps the dialog open', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog({
      currentVersion: '2.0.14',
      install: () => ({ status: 500, json: { error: 'install failed' } }),
    })

    await user.click(await screen.findByRole('button', { name: /v2\.1\.0/ }))
    await user.click(screen.getByRole('button', { name: /^Install$/i }))

    expect(await screen.findByText('Failed to install version')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: /^Install$/i })).toBeEnabled()
  })
})
