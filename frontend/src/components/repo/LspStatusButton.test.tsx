import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LspStatusButton } from './LspStatusButton'
import type { LspStatus } from '@/api/opencode'
import { useLSPStatus } from '@/hooks/useLSPStatus'

vi.mock('@/hooks/useLSPStatus')

describe('LspStatusButton', () => {
  const mockOnClick = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render button with LSP text', () => {
    vi.mocked(useLSPStatus).mockReturnValue({ data: undefined } as any)

    render(<LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />)

    expect(screen.getByText('LSP')).toBeInTheDocument()
  })

  it('should call onClick when clicked', () => {
    vi.mocked(useLSPStatus).mockReturnValue({ data: undefined } as any)

    render(<LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(mockOnClick).toHaveBeenCalledTimes(1)
  })

  it('should show green icon when has active servers', () => {
    const mockData: LspStatus[] = [
      { id: '1', name: 'typescript-language-server', status: 'connected', root: '/project' }
    ]
    vi.mocked(useLSPStatus).mockReturnValue({ data: mockData } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const icon = container.querySelector('.text-green-500')
    expect(icon).toBeInTheDocument()
  })

  it('should show default icon when no active servers', () => {
    const mockData: LspStatus[] = [
      { id: '1', name: 'typescript-language-server', status: 'error', root: '/project' }
    ]
    vi.mocked(useLSPStatus).mockReturnValue({ data: mockData } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const icon = container.querySelector('.text-green-500')
    expect(icon).not.toBeInTheDocument()
  })

  it('should show default icon when data is empty', () => {
    vi.mocked(useLSPStatus).mockReturnValue({ data: [] } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const icon = container.querySelector('.text-green-500')
    expect(icon).not.toBeInTheDocument()
  })

  it('should show default icon when data is undefined', () => {
    vi.mocked(useLSPStatus).mockReturnValue({ data: undefined } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const icon = container.querySelector('.text-green-500')
    expect(icon).not.toBeInTheDocument()
  })

  it('should handle multiple servers with mixed statuses', () => {
    const mockData: LspStatus[] = [
      { id: '1', name: 'typescript-language-server', status: 'connected', root: '/project' },
      { id: '2', name: 'python-lsp-server', status: 'error', root: '/project' }
    ]
    vi.mocked(useLSPStatus).mockReturnValue({ data: mockData } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const icon = container.querySelector('.text-green-500')
    expect(icon).toBeInTheDocument()
  })

  it('should hide on mobile screens (hidden md:flex)', () => {
    vi.mocked(useLSPStatus).mockReturnValue({ data: undefined } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const button = container.querySelector('button')
    expect(button).toHaveClass('hidden')
    expect(button).toHaveClass('md:flex')
  })

  it('should apply correct variant and size classes', () => {
    vi.mocked(useLSPStatus).mockReturnValue({ data: undefined } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const button = container.querySelector('button')
    expect(button).toHaveClass('outline')
    expect(button).toHaveClass('sm')
  })

  it('should apply transition and hover classes', () => {
    vi.mocked(useLSPStatus).mockReturnValue({ data: undefined } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const button = container.querySelector('button')
    expect(button).toHaveClass('transition-all')
    expect(button).toHaveClass('duration-200')
    expect(button).toHaveClass('hover:scale-105')
  })

  it('should render Code icon', () => {
    vi.mocked(useLSPStatus).mockReturnValue({ data: undefined } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('should hide LSP text on small screens', () => {
    vi.mocked(useLSPStatus).mockReturnValue({ data: undefined } as any)

    const { container } = render(
      <LspStatusButton opcodeUrl="http://localhost:5551" directory="/test" onClick={mockOnClick} />
    )

    const textSpan = container.querySelector('.hidden.sm.inline')
    expect(textSpan).toBeInTheDocument()
  })
})
