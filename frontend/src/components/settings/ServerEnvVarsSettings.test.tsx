import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ServerEnvVarsSettings } from './ServerEnvVarsSettings'
import { useSettings } from '@/hooks/useSettings'
import type { UserPreferences } from '@/api/types/settings'
import { createUseSettingsMock } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  updateSettingsAsync: vi.fn(),
  showToast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useSettings')
vi.mock('@/lib/toast', () => ({ showToast: mocks.showToast }))

function mockSettings(serverEnvVars: Array<{ key: string; value: string }> = []): void {
  vi.mocked(useSettings).mockReturnValue(
    createUseSettingsMock({
      preferences: { serverEnvVars } as UserPreferences,
      updateSettingsAsync: mocks.updateSettingsAsync,
    }),
  )
}

describe('ServerEnvVarsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateSettingsAsync.mockResolvedValue(undefined)
  })

  it('saves only serverEnvVars without the removed default-variable mechanism', async () => {
    const user = userEvent.setup()
    mockSettings([{ key: 'FOO', value: 'bar' }])

    render(<ServerEnvVarsSettings />)

    await user.click(screen.getByRole('button', { name: /Server Environment Variables/i }))
    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(mocks.updateSettingsAsync).toHaveBeenCalledWith({
      serverEnvVars: [{ key: 'FOO', value: 'bar' }],
    })
  })

  it('does not render a default variables section', async () => {
    const user = userEvent.setup()
    mockSettings()

    render(<ServerEnvVarsSettings />)

    await user.click(screen.getByRole('button', { name: /Server Environment Variables/i }))

    expect(screen.queryByText('Default variables')).not.toBeInTheDocument()
    expect(screen.queryByText(/OPENCODE_EXPERIMENTAL_WORKSPACES/)).not.toBeInTheDocument()
  })
})
