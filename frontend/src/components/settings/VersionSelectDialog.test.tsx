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
        { version: '1.19.0', tag: 'v1.19.0', name: '', publishedAt: '2026-01-01T00:00:00Z' },
        { version: '1.18.16', tag: 'v1.18.16', name: '', publishedAt: '2025-12-01T00:00:00Z' },
      ],
      currentVersion: '1.18.16',
    })
    mockInstallOpenCodeVersion.mockResolvedValue({ success: true, message: 'ok', oldVersion: null, newVersion: '1.19.0' })
  })

  it('lists versions and allows selection', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(await screen.findByText('v1.19.0')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /v1\.19\.0/ })
    expect(row).toBeEnabled()
    expect(screen.getByRole('button', { name: /Select version/i })).toBeDisabled()

    await user.click(row)

    expect(screen.getByRole('button', { name: /^Install$/i })).toBeEnabled()
  })

  it('installs the selected version', async () => {
    mockGetOpenCodeVersions.mockResolvedValue({
      versions: [
        { version: '1.19.0', tag: 'v1.19.0', name: '', publishedAt: '2026-01-01T00:00:00Z' },
        { version: '1.18.16', tag: 'v1.18.16', name: '', publishedAt: '2025-12-01T00:00:00Z' },
      ],
      currentVersion: '1.17.0',
    })

    const user = userEvent.setup()
    renderDialog()

    expect(await screen.findByText('v1.19.0')).toBeInTheDocument()
    const versionRow = screen.getByRole('button', { name: /v1\.19\.0/ })

    await user.click(versionRow)
    await user.click(screen.getByRole('button', { name: /^Install$/i }))

    expect(mockInstallOpenCodeVersion).toHaveBeenCalledWith('1.19.0')
    expect(refreshOpenCodeServerCaches).toHaveBeenCalledWith(expect.any(QueryClient), '1.19.0')
  })
})
