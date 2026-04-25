import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar, SidebarSection, SidebarItem, SidebarCollapseToggle } from './sidebar'
import { TooltipProvider } from './tooltip'
import { Folder } from 'lucide-react'

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
})
