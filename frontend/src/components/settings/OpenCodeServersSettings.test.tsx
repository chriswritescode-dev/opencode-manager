import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OpenCodeServer, OpenCodeServerTestResult } from '@opencode-manager/shared/schemas'
import { OpenCodeServersSettings } from './OpenCodeServersSettings'

const testResult: OpenCodeServerTestResult = {
  ok: true,
  version: '2.0.15',
  versionSupported: true,
  error: null,
}

const savedServer: OpenCodeServer = {
  id: 'srv_1',
  name: 'Office',
  baseUrl: 'https://office.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

const mocks = vi.hoisted(() => ({
  servers: [] as OpenCodeServer[],
  testAsync: vi.fn(),
  testByIdAsync: vi.fn(),
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: () => ({
    servers: mocks.servers,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    createAsync: vi.fn(),
    isCreating: false,
    updateAsync: vi.fn(),
    isUpdating: false,
    deleteAsync: vi.fn(),
    isDeleting: false,
    testAsync: mocks.testAsync,
    testByIdAsync: mocks.testByIdAsync,
  }),
}))

async function openEditDialog() {
  const user = userEvent.setup()
  render(<OpenCodeServersSettings />)
  await user.click(screen.getByRole('button', { name: 'Edit Office' }))
  return user
}

describe('OpenCodeServersSettings', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.servers = [savedServer]
    mocks.testAsync.mockResolvedValue(testResult)
    mocks.testByIdAsync.mockResolvedValue(testResult)
  })

  it('tests the saved server when the edited target and credentials are unchanged', async () => {
    const user = await openEditDialog()

    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(mocks.testByIdAsync).toHaveBeenCalledWith('srv_1')
    expect(mocks.testAsync).not.toHaveBeenCalled()
  })

  it('tests the edited address when the base URL changes', async () => {
    const user = await openEditDialog()

    await user.clear(screen.getByLabelText('URL'))
    await user.type(screen.getByLabelText('URL'), 'https://relocated.example.com')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(mocks.testAsync).toHaveBeenCalledWith({
      baseUrl: 'https://relocated.example.com',
      username: 'opencode',
      password: undefined,
    })
    expect(mocks.testByIdAsync).not.toHaveBeenCalled()
  })

  it('tests the edited address when the stored password is being cleared', async () => {
    const user = await openEditDialog()

    await user.click(screen.getByLabelText('Clear stored password'))
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(mocks.testAsync).toHaveBeenCalledWith({
      baseUrl: 'https://office.example.com',
      username: 'opencode',
      password: undefined,
    })
    expect(mocks.testByIdAsync).not.toHaveBeenCalled()
  })
})
