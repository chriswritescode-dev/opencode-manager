import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar, SidebarSection, SidebarItem, SidebarCollapseToggle } from './sidebar'
import { TooltipProvider } from './tooltip'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '@/hooks/useSidebarWidth'
import { Folder } from 'lucide-react'

Element.prototype.setPointerCapture ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}

describe('Sidebar', () => {
  it('renders children', () => {
    render(
      <Sidebar collapsed={false} onToggle={vi.fn()}>
        <div data-testid="child">Content</div>
      </Sidebar>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('applies collapsed width class when collapsed', () => {
    const { container } = render(
      <Sidebar collapsed={true} onToggle={vi.fn()}>
        <div>Content</div>
      </Sidebar>
    )

    expect(container.firstChild).toHaveClass('w-14')
  })

  it('applies expanded width class when not collapsed', () => {
    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()}>
        <div>Content</div>
      </Sidebar>
    )

    expect(container.firstChild).toHaveClass('w-60')
  })

  it('renders an inline width instead of the width class when width is provided', () => {
    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} width={320} onWidthChange={vi.fn()}>
        <div>Content</div>
      </Sidebar>
    )

    const aside = container.firstChild as HTMLElement
    expect(aside.style.width).toBe('320px')
    expect(aside).not.toHaveClass('w-60')
  })

  it('keeps the collapsed width class when collapsed even if width is provided', () => {
    const { container } = render(
      <Sidebar collapsed={true} onToggle={vi.fn()} width={320} onWidthChange={vi.fn()}>
        <div>Content</div>
      </Sidebar>
    )

    const aside = container.firstChild as HTMLElement
    expect(aside).toHaveClass('w-14')
    expect(aside.style.width).toBe('')
  })
})

describe('Sidebar resize handle', () => {
  it('is not rendered when collapsed', () => {
    render(
      <Sidebar collapsed={true} onToggle={vi.fn()} width={320} onWidthChange={vi.fn()}>
        <div>Content</div>
      </Sidebar>
    )

    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('is not rendered without onWidthChange', () => {
    render(
      <Sidebar collapsed={false} onToggle={vi.fn()} width={320}>
        <div>Content</div>
      </Sidebar>
    )

    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('exposes the current width via aria attributes', () => {
    render(
      <Sidebar collapsed={false} onToggle={vi.fn()} width={320} onWidthChange={vi.fn()}>
        <div>Content</div>
      </Sidebar>
    )

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    expect(handle).toHaveAttribute('aria-valuenow', '320')
    expect(handle).toHaveAttribute('aria-valuemin', String(SIDEBAR_MIN_WIDTH))
    expect(handle).toHaveAttribute('aria-valuemax', String(SIDEBAR_MAX_WIDTH))
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('reports the dragged width from the first pointer move', () => {
    const handleWidthChange = vi.fn()
    const { container } = render(
      <Sidebar collapsed={false} width={300} onWidthChange={handleWidthChange}>
        <div>Content</div>
      </Sidebar>
    )

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 340 })

    expect(handleWidthChange).toHaveBeenCalledWith(340)
    expect(container.firstChild).toHaveClass('transition-none')
  })

  it('ignores pointer moves from another pointer id', () => {
    const handleWidthChange = vi.fn()
    render(
      <Sidebar collapsed={false} width={300} onWidthChange={handleWidthChange}>
        <div>Content</div>
      </Sidebar>
    )

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 400 })

    expect(handleWidthChange).not.toHaveBeenCalled()
  })

  it('stops reporting after pointer up and restores the transition classes', () => {
    const handleWidthChange = vi.fn()
    const { container } = render(
      <Sidebar collapsed={false} width={300} onWidthChange={handleWidthChange}>
        <div>Content</div>
      </Sidebar>
    )

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 320 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 360 })

    expect(handleWidthChange).not.toHaveBeenCalled()
    expect(container.firstChild).toHaveClass('transition-[width]')
  })

  it('adjusts the width from the keyboard', () => {
    const handleWidthChange = vi.fn()
    render(
      <Sidebar collapsed={false} width={300} onWidthChange={handleWidthChange}>
        <div>Content</div>
      </Sidebar>
    )

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handleWidthChange).toHaveBeenLastCalledWith(316)

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handleWidthChange).toHaveBeenLastCalledWith(284)

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(handleWidthChange).toHaveBeenLastCalledWith(364)

    fireEvent.keyDown(handle, { key: 'Home' })
    expect(handleWidthChange).toHaveBeenLastCalledWith(SIDEBAR_MIN_WIDTH)

    fireEvent.keyDown(handle, { key: 'End' })
    expect(handleWidthChange).toHaveBeenLastCalledWith(SIDEBAR_MAX_WIDTH)
  })

  it('ignores unhandled keys', () => {
    const handleWidthChange = vi.fn()
    render(
      <Sidebar collapsed={false} width={300} onWidthChange={handleWidthChange}>
        <div>Content</div>
      </Sidebar>
    )

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize sidebar' }), { key: 'a' })

    expect(handleWidthChange).not.toHaveBeenCalled()
  })
})

describe('SidebarSection', () => {
  it('renders label when not collapsed', () => {
    render(
      <SidebarSection label="Test Section" collapsed={false}>
        <div>Content</div>
      </SidebarSection>
    )

    expect(screen.getByText('Test Section')).toBeInTheDocument()
  })

  it('hides label when collapsed', () => {
    render(
      <SidebarSection label="Test Section" collapsed={true}>
        <div>Content</div>
      </SidebarSection>
    )

    expect(screen.queryByText('Test Section')).not.toBeInTheDocument()
  })
})

describe('SidebarItem', () => {
  it('fires onClick when clicked', () => {
    const handleClick = vi.fn()

    render(
      <SidebarItem
        icon={Folder}
        label="Test Item"
        collapsed={false}
        onClick={handleClick}
      />
    )

    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('applies active styles when active', () => {
    render(
      <SidebarItem
        icon={Folder}
        label="Test Item"
        collapsed={false}
        active={true}
      />
    )

    expect(screen.getByRole('button')).toHaveClass('bg-accent')
  })

  it('uses title attribute when collapsed', () => {
    render(
      <TooltipProvider>
        <SidebarItem
          icon={Folder}
          label="Test Item"
          collapsed={true}
        />
      </TooltipProvider>
    )

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Test Item')
  })
})

describe('SidebarCollapseToggle', () => {
  it('calls onToggle when clicked', () => {
    const handleToggle = vi.fn()

    render(
      <SidebarCollapseToggle collapsed={false} onToggle={handleToggle} />
    )

    fireEvent.click(screen.getByRole('button'))
    expect(handleToggle).toHaveBeenCalledTimes(1)
  })

  it('calls onToggle when clicked while collapsed', () => {
    const handleToggle = vi.fn()

    render(
      <SidebarCollapseToggle collapsed={true} onToggle={handleToggle} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(handleToggle).toHaveBeenCalledTimes(1)
  })

  it('exposes expanded state via accessible name and aria-expanded', () => {
    const { rerender } = render(
      <SidebarCollapseToggle collapsed={false} onToggle={vi.fn()} />
    )

    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' })
    ).toHaveAttribute('aria-expanded', 'true')

    rerender(<SidebarCollapseToggle collapsed={true} onToggle={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'Expand sidebar' })
    ).toHaveAttribute('aria-expanded', 'false')
  })
})
