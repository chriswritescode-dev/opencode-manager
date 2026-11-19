import { beforeAll, describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeneralSettings } from './GeneralSettings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import { installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { VersionInfo } from '@/api/settings'

const VERSION: VersionInfo = {
  currentVersion: 'v1.2.3',
  latestVersion: null,
  updateAvailable: false,
  releaseUrl: null,
  releaseName: null,
}

const modelRoutes: FetchRoute[] = [
  { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: { recent: [], favorite: [], variant: {} } }) },
  { method: 'GET', path: '/api/opencode/api/provider', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: '/api/opencode/api/model', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
  { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { data: null } }) },
]

interface RenderOptions {
  version?: Partial<VersionInfo>
  patch?: () => FetchRouteResult | Promise<FetchRouteResult>
}

async function renderGeneral(options: RenderOptions = {}) {
  const settings = createSettingsServer(
    {
      theme: 'dark',
      simpleChatMode: false,
      autoScroll: true,
      showReasoning: false,
      expandToolCalls: false,
      expandDiffs: true,
    },
    { patch: options.patch },
  )
  const result = renderWithProviders(<GeneralSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes: [
      ...settings.routes,
      { method: 'GET', path: '/api/health/version', respond: () => ({ json: { ...VERSION, ...options.version } }) },
      ...modelRoutes,
    ],
  })
  await screen.findByRole('heading', { name: 'General Preferences' })
  return { ...result, settings }
}

function patchBodies(fetchFake: ReturnType<typeof renderWithProviders>['fetchFake']) {
  return fetchFake.findRequests('PATCH', '/api/settings').map((request) => request.body)
}

describe('GeneralSettings', () => {
  beforeAll(() => {
    installPointerCapture()
  })

  it('renders the compact heading row with version info and associated preference rows', async () => {
    await renderGeneral({
      version: { latestVersion: '1.3.0', updateAvailable: true, releaseUrl: 'https://example.com/release' },
    })

    expect(screen.getByRole('heading', { name: 'General Preferences' })).toBeInTheDocument()
    expect(await screen.findByText('v1.2.3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'v1.3.0 available' })).toHaveAttribute('href', 'https://example.com/release')

    expect(screen.getByLabelText('Appearance')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Simple chat mode' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Auto-scroll' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Show reasoning' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Expand tool calls' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Expand diffs' })).toBeChecked()

    expect(screen.getByRole('heading', { name: 'Change walkthrough' })).toBeInTheDocument()
    expect(screen.getByText('Walkthrough model')).toBeInTheDocument()
  })

  it('writes the theme and toggle preferences', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderGeneral()

    await user.click(screen.getByRole('combobox', { name: 'Appearance' }))
    await user.click(screen.getByRole('option', { name: 'Light' }))

    await user.click(screen.getByRole('switch', { name: 'Auto-scroll' }))

    expect(patchBodies(fetchFake)).toEqual([
      { preferences: { theme: 'light' } },
      { preferences: { autoScroll: false } },
    ])
  })

  it('defaults the color theme to Manager and persists a chosen OpenCode theme', async () => {
    const user = userEvent.setup()
    const { fetchFake } = await renderGeneral()

    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveTextContent('Manager')

    await user.click(screen.getByRole('combobox', { name: 'Theme' }))
    expect(screen.getByRole('option', { name: 'Manager' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'OpenCode' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Dracula' }))

    expect(patchBodies(fetchFake)).toEqual([{ preferences: { colorTheme: 'dracula' } }])
  })

  it('hides the reasoning, tool call, and diff rows while simple chat mode is on', () => {
    const settings = createSettingsServer({ simpleChatMode: true })
    renderWithProviders(<GeneralSettings />, {
      auth: false,
      theme: false,
      tts: false,
      fetchRoutes: [
        ...settings.routes,
        { method: 'GET', path: '/api/health/version', respond: () => ({ json: VERSION }) },
        ...modelRoutes,
      ],
    })

    return waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Simple chat mode' })).toBeChecked()
      expect(screen.queryByRole('switch', { name: 'Show reasoning' })).not.toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: 'Expand tool calls' })).not.toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: 'Expand diffs' })).not.toBeInTheDocument()
    })
  })

  it('shows the saving state while preferences are updating', async () => {
    const user = userEvent.setup()
    await renderGeneral({ patch: () => new Promise<FetchRouteResult>(() => undefined) })

    await user.click(screen.getByRole('switch', { name: 'Auto-scroll' }))

    expect(await screen.findByText('Saving...')).toBeInTheDocument()
  })
})
