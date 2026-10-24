import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionDetailsSheet, type SessionDetailsSheetProps } from './SessionDetailsSheet'

const mocks = vi.hoisted(() => ({
  useMobile: vi.fn(),
  useUpdateSession: vi.fn(),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
  useSwipeBack: vi.fn(() => ({ bind: vi.fn(), swipeProgress: 0, swipeStyles: {} })),
  useSwipeDismiss: vi.fn(() => ({ bind: vi.fn(), swipeProgress: 0, swipeStyles: {} })),
}))

vi.mock('@/hooks/useOpenCode', () => ({ useUpdateSession: mocks.useUpdateSession }))

type RenameMutation = {
  mutate: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  error: Error | null
  isPending: boolean
}

const baseProps: SessionDetailsSheetProps = {
  open: true,
  onOpenChange: vi.fn(),
  sessionId: 'ses_1',
  title: 'Fix the header',
  remote: false,
  project: 'oc-manager',
}

function mockRename(overrides: Partial<RenameMutation> = {}): RenameMutation {
  const mutation: RenameMutation = {
    mutate: vi.fn(),
    reset: vi.fn(),
    error: null,
    isPending: false,
    ...overrides,
  }
  mocks.useUpdateSession.mockReturnValue(mutation)
  return mutation
}

function renderSheet(overrides: Partial<SessionDetailsSheetProps> = {}) {
  return render(<SessionDetailsSheet {...baseProps} {...overrides} />)
}

describe('SessionDetailsSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMobile.mockReturnValue(false)
    mockRename()
  })

  it('lists the local session details', () => {
    renderSheet({ branch: 'feat/header', directory: '/abs/repos/oc-manager' })

    expect(screen.getByText('Session details')).toBeInTheDocument()
    expect(screen.getByText('Fix the header')).toBeInTheDocument()
    expect(screen.getByText('Local')).toBeInTheDocument()
    expect(screen.getByText('oc-manager')).toBeInTheDocument()
    expect(screen.getByText('feat/header')).toBeInTheDocument()
    expect(screen.getByText('/abs/repos/oc-manager')).toBeInTheDocument()
  })

  it('shows the linked server name and marks the session as remote', () => {
    renderSheet({ remote: true, serverName: 'Kitchen' })

    expect(screen.getByText('Kitchen')).toBeInTheDocument()
  })

  it('falls back to a remote server label without a server name', () => {
    renderSheet({ remote: true })

    expect(screen.getByText('Remote server')).toBeInTheDocument()
  })

  it('omits branch and directory rows when they are unknown', () => {
    renderSheet({ branch: null })

    expect(screen.queryByText('Branch')).not.toBeInTheDocument()
    expect(screen.queryByText('Directory')).not.toBeInTheDocument()
  })

  it('falls back to an untitled session label', () => {
    renderSheet({ title: '   ' })

    expect(screen.getByText('Untitled Session')).toBeInTheDocument()
  })

  it('prefills the rename field with the raw title', () => {
    renderSheet({ title: '  Raw title  ' })

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    expect(screen.getByLabelText('Session title')).toHaveValue('  Raw title  ')
  })

  it('leaves the rename field empty when the session has no title', () => {
    renderSheet({ title: undefined })

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    expect(screen.getByLabelText('Session title')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('disables Save while the trimmed draft is empty', () => {
    renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves the trimmed title and leaves edit mode on success', () => {
    const mutation = mockRename()
    renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Session title'), {
      target: { value: '  New name  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mutation.mutate).toHaveBeenCalledWith(
      { sessionID: 'ses_1', title: 'New name' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )

    const options = mutation.mutate.mock.calls[0]![1] as { onSuccess: () => void }
    act(() => options.onSuccess())

    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument()
    expect(screen.getByText('Fix the header')).toBeInTheDocument()
  })

  it('saves on Enter', () => {
    const mutation = mockRename()
    renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: 'Entered' } })
    fireEvent.keyDown(screen.getByLabelText('Session title'), { key: 'Enter' })

    expect(mutation.mutate).toHaveBeenCalledWith(
      { sessionID: 'ses_1', title: 'Entered' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('cancels editing and resets the rename error', () => {
    const mutation = mockRename({ error: new Error('nope') })
    renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByText('Rename failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument()
    expect(mutation.reset).toHaveBeenCalled()
  })

  it('shows the rename failure inline', () => {
    mockRename({ error: new Error('nope') })
    renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    expect(screen.getByText('Rename failed')).toBeInTheDocument()
  })

  it('disables the title field while a rename is pending', () => {
    mockRename({ isPending: true })
    renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    expect(screen.getByLabelText('Session title')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('does not dismiss while a rename is pending', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mockRename({ isPending: true })
    renderSheet({ onOpenChange })

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.keyboard('{Escape}')

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('resets to view mode and clears the error when reopened', () => {
    const mutation = mockRename({ error: new Error('nope') })

    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen((current) => !current)}>
            toggle
          </button>
          <SessionDetailsSheet {...baseProps} open={open} onOpenChange={setOpen} />
        </>
      )
    }

    render(<Host />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByLabelText('Session title')).toBeInTheDocument()

    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('toggle'))

    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
    expect(mutation.reset).toHaveBeenCalled()
  })

  it('renders as a bottom sheet on mobile', () => {
    mocks.useMobile.mockReturnValue(true)
    renderSheet({ branch: 'feat/header' })

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Session details')
    expect(screen.getByText('feat/header')).toBeInTheDocument()
  })
})
