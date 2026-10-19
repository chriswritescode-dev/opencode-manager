import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { useSidebarServerSelection } from './useSidebarServerSelection'
import { SIDEBAR_SERVER_STORAGE_KEY, useSidebarServerStore } from '@/stores/sidebarServerStore'

const mocks = vi.hoisted(() => ({
  useOpenCodeServers: vi.fn(),
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: mocks.useOpenCodeServers,
  useOpenCodeServerStatuses: () => ({ statuses: [], statusById: {}, isLoading: false }),
}))

const kitchen = {
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
  enabled: true,
  hasPassword: true,
  createdAt: 1,
  updatedAt: 2,
}

const office = { ...kitchen, id: 'srv_office', name: 'Office' }

function SelectionHarness() {
  const [serverId, selectServer] = useSidebarServerSelection()
  const navigate = useNavigate()

  return (
    <>
      <div data-testid="selected">{serverId}</div>
      <button type="button" onClick={() => selectServer('srv_kitchen')}>
        Select kitchen
      </button>
      <button type="button" onClick={() => navigate('/repos/2')}>
        Go to repo
      </button>
      <button type="button" onClick={() => navigate('/servers/srv_office')}>
        Go to office
      </button>
    </>
  )
}

function renderHarness(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SelectionHarness />
    </MemoryRouter>,
  )
}

describe('useSidebarServerSelection', () => {
  beforeEach(() => {
    localStorage.clear()
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
    mocks.useOpenCodeServers.mockReturnValue({ servers: [kitchen, office], isLoading: false })
  })

  it('defaults to the local server', () => {
    renderHarness()

    expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID)
  })

  it('selects the server named by a linked server route', async () => {
    renderHarness('/servers/srv_kitchen/projects?directory=%2Fprojects%2Falpha')

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('srv_kitchen'))
  })

  it('selects local on a local repo route', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })

    renderHarness('/repos/1')

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
  })

  it('keeps a manual selection while the local route stays unchanged', async () => {
    renderHarness('/repos/1')

    fireEvent.click(screen.getByRole('button', { name: 'Select kitchen' }))

    expect(screen.getByTestId('selected')).toHaveTextContent('srv_kitchen')
  })

  it('follows a navigation to another linked server', async () => {
    renderHarness('/servers/srv_kitchen')

    fireEvent.click(screen.getByRole('button', { name: 'Go to office' }))

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('srv_office'))
  })

  it('follows a navigation back to a local route', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    renderHarness('/servers/srv_kitchen')

    fireEvent.click(screen.getByRole('button', { name: 'Go to repo' }))

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
  })

  it('falls back to local when the selected server is disabled', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_office' })
    mocks.useOpenCodeServers.mockReturnValue({
      servers: [kitchen, { ...office, enabled: false }],
      isLoading: false,
    })

    renderHarness()

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
  })

  it('falls back to local when the selected server no longer exists', async () => {
    useSidebarServerStore.setState({ serverId: 'srv_gone' })

    renderHarness()

    await waitFor(() =>
      expect(screen.getByTestId('selected')).toHaveTextContent(LOCAL_OPENCODE_SERVER_ID),
    )
  })

  it('persists the selection', () => {
    renderHarness()

    fireEvent.click(screen.getByRole('button', { name: 'Select kitchen' }))

    expect(JSON.parse(localStorage.getItem(SIDEBAR_SERVER_STORAGE_KEY) ?? 'null')).toBe(
      'srv_kitchen',
    )
  })
})
