import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VersionSelectDialog } from './VersionSelectDialog'
import { settingsApi } from '@/api/settings'
import { refreshOpenCodeServerCaches } from '@/lib/queryInvalidation'

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeVersions: vi.fn(),
    installOpenCodeVersion: vi.fn(),
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))
vi.mock('@/lib/queryInvalidation', () => ({
  refreshOpenCodeServerCaches: vi.fn(),
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

describe('VersionSelectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOpenCodeVersions.mockResolvedValue({
      versions: [
        { version: '2.1.0', tag: 'v2.1.0', name: '', publishedAt: '2026-01-01T00:00:00Z' },
        { version: '2.0.15', tag: 'v2.0.15', name: '', publishedAt: '2025-12-01T00:00:00Z' },
      ],
      currentVersion: '2.0.15',
    })
    mockInstallOpenCodeVersion.mockResolvedValue({ success: true, message: 'ok', oldVersion: null, newVersion: '2.1.0' })
  })

  it('lists versions and allows selection', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(await screen.findByText('v2.1.0')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /v2\.1\.0/ })
    expect(row).toBeEnabled()
    expect(screen.getByRole('button', { name: /Select version/i })).toBeDisabled()

    await user.click(row)

    expect(screen.getByRole('button', { name: /^Install$/i })).toBeEnabled()
  })

  it('installs the selected version', async () => {
    mockGetOpenCodeVersions.mockResolvedValue({
      versions: [
        { version: '2.1.0', tag: 'v2.1.0', name: '', publishedAt: '2026-01-01T00:00:00Z' },
        { version: '2.0.15', tag: 'v2.0.15', name: '', publishedAt: '2025-12-01T00:00:00Z' },
      ],
      currentVersion: '2.0.14',
    })

    const user = userEvent.setup()
    renderDialog()

    expect(await screen.findByText('v2.1.0')).toBeInTheDocument()
    const versionRow = screen.getByRole('button', { name: /v2\.1\.0/ })

    await user.click(versionRow)
    await user.click(screen.getByRole('button', { name: /^Install$/i }))

    expect(mockInstallOpenCodeVersion).toHaveBeenCalledWith('2.1.0')
    expect(refreshOpenCodeServerCaches).toHaveBeenCalledWith(expect.any(QueryClient), '2.1.0')
  })
})
