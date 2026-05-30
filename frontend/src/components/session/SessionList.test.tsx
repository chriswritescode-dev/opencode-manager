import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionList } from './SessionList'

const { createSessionMock, deleteSessionMock, sessionsData, createSessionState } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  sessionsData: [] as Array<{ id: string; title: string; directory: string; workspaceID?: string; time: { updated: number } }>,
  createSessionState: { directory: undefined as string | undefined },
}))

vi.mock('@/hooks/useOpenCode', () => ({
  useSessionsAcrossDirectories: () => ({
    data: sessionsData,
    isLoading: false,
  }),
  useCreateSession: (_opcodeUrl: string, directory?: string) => {
    createSessionState.directory = directory
    return { mutate: createSessionMock }
  },
  useDeleteSession: () => ({ mutateAsync: deleteSessionMock, isPending: false }),
}))

describe('SessionList', () => {
  beforeEach(() => {
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/a', workspaceID: 'wrk_a', time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/b', workspaceID: 'wrk_b', time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/c', workspaceID: 'wrk_c', time: { updated: Date.now() } },
    )
    createSessionMock.mockReset()
    createSessionState.directory = undefined
    deleteSessionMock.mockReset()
    deleteSessionMock.mockResolvedValue(undefined)
  })

  it('selects duplicate session IDs independently by workspace directory', async () => {
    const user = userEvent.setup()

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a', '/w/b', '/w/c']}
        onSelectSession={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Manage sessions' }))
    await user.click(screen.getByRole('button', { name: 'Select All' }))

    expect(screen.getByText('3 selected')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog', { name: 'Delete Sessions' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteSessionMock).toHaveBeenCalledWith([
        { id: 'ses_same', directory: '/w/a', workspaceID: 'wrk_a' },
        { id: 'ses_same', directory: '/w/b', workspaceID: 'wrk_b' },
        { id: 'ses_same', directory: '/w/c', workspaceID: 'wrk_c' },
      ])
    })
  })

  it('deduplicates repeated session records from the same workspace directory', async () => {
    const user = userEvent.setup()
    sessionsData.splice(0, sessionsData.length,
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/a', time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/a', time: { updated: Date.now() } },
      { id: 'ses_same', title: 'audit: mic-warmup 1/2 #2', directory: '/w/a', time: { updated: Date.now() } },
    )

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a', '/w/a', '/w/a']}
        onSelectSession={vi.fn()}
      />,
    )

    expect(screen.getAllByText('audit: mic-warmup 1/2 #2')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Manage sessions' }))
    await user.click(screen.getByRole('button', { name: 'Select All' }))

    expect(screen.getByText('1 selected')).toBeTruthy()
  })

  it('creates sessions in the explicit create directory', async () => {
    const user = userEvent.setup()
    sessionsData.splice(0, sessionsData.length)

    render(
      <SessionList
        opcodeUrl="/api/opencode"
        directories={['/w/a', '/w/b']}
        createDirectory="/w/b"
        onSelectSession={vi.fn()}
      />,
    )

    await user.click(screen.getByText('No sessions yet'))

    expect(createSessionState.directory).toBe('/w/b')
    expect(createSessionMock).toHaveBeenCalledWith({ agent: undefined })
  })
})
