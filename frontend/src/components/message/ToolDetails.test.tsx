import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ShellPreview, ToolDetails, useToolDetailsState } from './ToolDetails'

const mocks = vi.hoisted(() => ({
  useMobile: vi.fn(),
}))

vi.mock('@/hooks/useMobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useMobile')>()),
  useMobile: mocks.useMobile,
}))

const Details = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
  <ToolDetails open={open} onOpenChange={onOpenChange} title="$ git status">
    <p>detail body</p>
  </ToolDetails>
)

function StateProbe({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useToolDetailsState(defaultOpen)
  return (
    <>
      <span>{open ? 'open' : 'closed'}</span>
      <button type="button" onClick={() => setOpen(false)}>
        close details
      </button>
    </>
  )
}

describe('ToolDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the detail inline on desktop when open', () => {
    mocks.useMobile.mockReturnValue(false)

    render(<Details open onOpenChange={vi.fn()} />)

    expect(screen.getByText('detail body')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders nothing inline on desktop when closed', () => {
    mocks.useMobile.mockReturnValue(false)

    render(<Details open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByText('detail body')).not.toBeInTheDocument()
  })

  it('renders the detail inside a dialog on mobile when open', () => {
    mocks.useMobile.mockReturnValue(true)

    render(<Details open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('detail body')).toBeInTheDocument()
    expect(screen.getByText('$ git status')).toBeInTheDocument()
  })

  it('renders nothing on mobile when closed', () => {
    mocks.useMobile.mockReturnValue(true)

    render(<Details open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('detail body')).not.toBeInTheDocument()
  })
})

describe('useToolDetailsState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts closed on mobile even when the default is open', () => {
    mocks.useMobile.mockReturnValue(true)

    render(<StateProbe defaultOpen />)

    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('starts open on desktop when the default is open', () => {
    mocks.useMobile.mockReturnValue(false)

    render(<StateProbe defaultOpen />)

    expect(screen.getByText('open')).toBeInTheDocument()
  })

  it('starts closed on desktop when the default is closed', () => {
    mocks.useMobile.mockReturnValue(false)

    render(<StateProbe defaultOpen={false} />)

    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('follows a default that turns open after mount on desktop', () => {
    mocks.useMobile.mockReturnValue(false)

    const { rerender } = render(<StateProbe defaultOpen={false} />)

    expect(screen.getByText('closed')).toBeInTheDocument()

    rerender(<StateProbe defaultOpen />)

    expect(screen.getByText('open')).toBeInTheDocument()
  })

  it('keeps the user choice when a later default differs', () => {
    mocks.useMobile.mockReturnValue(false)

    const { rerender } = render(<StateProbe defaultOpen />)

    expect(screen.getByText('open')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'close details' }))

    expect(screen.getByText('closed')).toBeInTheDocument()

    rerender(<StateProbe defaultOpen />)

    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('closes when the viewport shrinks to mobile after opening on desktop', () => {
    mocks.useMobile.mockReturnValue(false)

    const { rerender } = render(<StateProbe defaultOpen />)

    expect(screen.getByText('open')).toBeInTheDocument()

    mocks.useMobile.mockReturnValue(true)
    rerender(<StateProbe defaultOpen />)

    expect(screen.getByText('closed')).toBeInTheDocument()
  })
})

describe('ShellPreview', () => {
  const output = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join('\n')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the last 10 output lines on desktop', () => {
    mocks.useMobile.mockReturnValue(false)

    render(<ShellPreview command="ls" output={output} onClick={vi.fn()} />)

    expect(screen.getByText('(15 earlier lines)')).toBeInTheDocument()
  })

  it('shows only the last 4 output lines on mobile', () => {
    mocks.useMobile.mockReturnValue(true)

    render(<ShellPreview command="ls" output={output} onClick={vi.fn()} />)

    expect(screen.getByText('(21 earlier lines)')).toBeInTheDocument()
  })
})
