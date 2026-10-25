import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionDetailsSheet, type SessionDetailsSheetProps } from './SessionDetailsSheet'

const mocks = vi.hoisted(() => ({
  useMobile: vi.fn(),
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
  useSwipeBack: vi.fn(() => ({ bind: vi.fn(), swipeProgress: 0, swipeStyles: {} })),
  useSwipeDismiss: vi.fn(() => ({ bind: vi.fn(), swipeProgress: 0, swipeStyles: {} })),
}))

const baseProps: SessionDetailsSheetProps = {
  open: true,
  onOpenChange: vi.fn(),
  title: 'Fix the header',
  remote: false,
  project: 'oc-manager',
  onRename: vi.fn(() => Promise.resolve()),
}

function createDeferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function failingRename(error = new Error('nope')) {
  return vi.fn(() => Promise.reject(error))
}

function renderSheet(overrides: Partial<SessionDetailsSheetProps> = {}) {
  return render(<SessionDetailsSheet {...baseProps} {...overrides} />)
}

describe('SessionDetailsSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMobile.mockReturnValue(false)
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

  it('saves the trimmed title and leaves edit mode on success', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn(() => Promise.resolve())
    renderSheet({ onRename })

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.clear(screen.getByLabelText('Session title'))
    await user.type(screen.getByLabelText('Session title'), '  New name  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onRename).toHaveBeenCalledWith('New name')
    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument()
    expect(screen.getByText('Fix the header')).toBeInTheDocument()
  })

  it('saves on Enter', async () => {
    const onRename = vi.fn(() => Promise.resolve())
    renderSheet({ onRename })

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Session title'), { target: { value: 'Entered' } })
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('Session title'), { key: 'Enter' })
    })

    expect(onRename).toHaveBeenCalledWith('Entered')
  })

  it('ignores Enter while an IME composition is active', () => {
    const onRename = vi.fn(() => Promise.resolve())
    renderSheet({ onRename })

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Session title')
    fireEvent.change(input, { target: { value: 'にほんご' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(onRename).not.toHaveBeenCalled()
  })

  it('shows the rename failure inline', async () => {
    const user = userEvent.setup()
    renderSheet({ onRename: failingRename() })

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Rename failed')).toBeInTheDocument()
    expect(screen.getByLabelText('Session title')).toBeInTheDocument()
  })

  it('cancels editing and clears the rename error', async () => {
    const user = userEvent.setup()
    renderSheet({ onRename: failingRename() })

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Rename failed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Rename failed')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument()
  })

  it('disables the title field while a rename is pending', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred()
    renderSheet({ onRename: () => deferred.promise })

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByLabelText('Session title')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await act(async () => {
      deferred.resolve()
    })
  })

  it('does not dismiss while a rename is pending', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred()
    const onOpenChange = vi.fn()
    renderSheet({ onOpenChange, onRename: () => deferred.promise })

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      deferred.resolve()
    })
  })

  it('resets to view mode and clears the error when reopened', async () => {
    const user = userEvent.setup()

    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen((current) => !current)}>
            toggle
          </button>
          <SessionDetailsSheet
            {...baseProps}
            open={open}
            onOpenChange={setOpen}
            onRename={failingRename()}
          />
        </>
      )
    }

    render(<Host />)

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Rename failed')).toBeInTheDocument()

    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('toggle'))

    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument()
    expect(screen.queryByText('Rename failed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
  })

  it('renders as a bottom sheet on mobile', () => {
    mocks.useMobile.mockReturnValue(true)
    renderSheet({ branch: 'feat/header' })

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Session details')
    expect(screen.getByText('feat/header')).toBeInTheDocument()
  })
})
