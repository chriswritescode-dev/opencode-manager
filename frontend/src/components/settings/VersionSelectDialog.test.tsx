import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VersionSelectDialog } from './VersionSelectDialog'
import { settingsApi } from '@/api/settings'
import { useServerHealth } from '@/hooks/useServerHealth'

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeVersions: vi.fn(),
    installOpenCodeVersion: vi.fn(),
  },
}))

vi.mock('@/hooks/useServerHealth')
vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
vi.mock('@/lib/queryInvalidation', () => ({
  invalidateConfigCaches: vi.fn(),
  updateOpenCodeVersionCaches: vi.fn(),
}))

const mockGetOpenCodeVersions = settingsApi.getOpenCodeVersions as ReturnType<typeof vi.fn>
const mockInstallOpenCodeVersion = settingsApi.installOpenCodeVersion as ReturnType<typeof vi.fn>

function renderDialog(open = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <VersionSelectDialog open={open} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

function mockHealth(enforced: boolean) {
  vi.mocked(useServerHealth).mockReturnValue({
    data: { sandbox: { available: true, enforced } },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    restartMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    rollbackMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  } as ReturnType<typeof useServerHealth>)
}

describe('VersionSelectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOpenCodeVersions.mockResolvedValue({
      versions: [
        { version: '1.19.0', tag: 'v1.19.0', name: '', publishedAt: '2026-01-01T00:00:00Z', installable: true },
        { version: '1.18.16', tag: 'v1.18.16', name: '', publishedAt: '2025-12-01T00:00:00Z', installable: true },
      ],
      currentVersion: '1.18.16',
    })
    mockInstallOpenCodeVersion.mockResolvedValue({ success: true, message: 'ok', oldVersion: null, newVersion: '1.19.0' })
    mockHealth(false)
  })

  it('lists versions and allows selection when sandboxing is off', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(await screen.findByText('v1.19.0')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /v1\.19\.0/ })
    expect(row).toBeEnabled()
    expect(screen.getByRole('button', { name: /Select version/i })).toBeDisabled()

    await user.click(row)

    expect(screen.getByRole('button', { name: /^Install$/i })).toBeEnabled()
  })

  it('keeps verified versions installable and disables unverified versions when sandbox enforcement is on', async () => {
    mockHealth(true)
    mockGetOpenCodeVersions.mockResolvedValue({
      versions: [
        { version: '1.19.0', tag: 'v1.19.0', name: '', publishedAt: '2026-01-01T00:00:00Z', installable: false },
        { version: '1.18.16', tag: 'v1.18.16', name: '', publishedAt: '2025-12-01T00:00:00Z', installable: true },
      ],
      currentVersion: '1.17.0',
    })

    renderDialog()

    expect(
      await screen.findByText(/only verified OpenCode versions can be installed/),
    ).toBeInTheDocument()
    const unverifiedRow = screen.getByRole('button', { name: /v1\.19\.0/ })
    const verifiedRow = screen.getByRole('button', { name: /v1\.18\.16/ })
    expect(unverifiedRow).toBeDisabled()
    expect(verifiedRow).toBeEnabled()
    expect(screen.getByRole('button', { name: /Select version/i })).toBeDisabled()

    const user = userEvent.setup()
    await user.click(verifiedRow)

    expect(screen.getByRole('button', { name: /^Install$/i })).toBeEnabled()
  })

  it('keeps the install button disabled when the only available row is unverified under enforcement', async () => {
    mockHealth(true)
    mockGetOpenCodeVersions.mockResolvedValue({
      versions: [
        { version: '1.19.0', tag: 'v1.19.0', name: '', publishedAt: '2026-01-01T00:00:00Z', installable: false },
      ],
      currentVersion: '1.17.0',
    })

    const user = userEvent.setup()
    renderDialog()

    expect(await screen.findByText('v1.19.0')).toBeInTheDocument()
    const unverifiedRow = screen.getByRole('button', { name: /v1\.19\.0/ })
    expect(unverifiedRow).toBeDisabled()
    await user.click(unverifiedRow)

    expect(screen.getByRole('button', { name: /Select version/i })).toBeDisabled()
  })
})
