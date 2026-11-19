import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OpenCodeServer, OpenCodeServerTestResult } from '@opencode-manager/shared/schemas'
import { OpenCodeServersSettings } from './OpenCodeServersSettings'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

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

const fetchRoutes: FetchRoute[] = [
  { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: { servers: [savedServer] } }) },
  { method: 'GET', path: '/api/opencode-servers/status', respond: () => ({ json: { statuses: [] } }) },
  { method: 'POST', path: '/api/opencode-servers/test', respond: () => ({ json: testResult }) },
  { method: 'POST', path: '/api/opencode-servers/:id/test', respond: () => ({ json: testResult }) },
]

async function openEditDialog() {
  const user = userEvent.setup()
  const result = renderWithProviders(<OpenCodeServersSettings />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
  await user.click(await screen.findByRole('button', { name: 'Edit Office' }))
  return { ...result, user }
}

describe('OpenCodeServersSettings', () => {
  it('tests the draft with the saved server id when the password is left blank', async () => {
    const { user, fetchFake } = await openEditDialog()

    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Connected — OpenCode 2.0.15')).toBeInTheDocument()
    expect(fetchFake.lastRequest('POST', '/api/opencode-servers/test')?.body).toEqual({
      baseUrl: 'https://office.example.com',
      username: 'opencode',
      serverId: 'srv_1',
    })
    expect(fetchFake.findRequests('POST', '/api/opencode-servers/:id/test')).toHaveLength(0)
  })

  it('tests the edited address with the saved server id', async () => {
    const { user, fetchFake } = await openEditDialog()

    await user.clear(screen.getByLabelText('URL'))
    await user.type(screen.getByLabelText('URL'), 'https://relocated.example.com')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(fetchFake.lastRequest('POST', '/api/opencode-servers/test')?.body).toEqual({
      baseUrl: 'https://relocated.example.com',
      username: 'opencode',
      serverId: 'srv_1',
    })
  })

  it('tests the edited address without the saved server id when the stored password is being cleared', async () => {
    const { user, fetchFake } = await openEditDialog()

    await user.click(screen.getByLabelText('Clear stored password'))
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(fetchFake.lastRequest('POST', '/api/opencode-servers/test')?.body).toEqual({
      baseUrl: 'https://office.example.com',
      username: 'opencode',
    })
  })
})
