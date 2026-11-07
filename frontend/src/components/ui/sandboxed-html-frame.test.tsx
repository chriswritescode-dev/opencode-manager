import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SandboxedHtmlFrame } from './sandboxed-html-frame'

describe('SandboxedHtmlFrame', () => {
  it('restricts the iframe to allow-scripts without same-origin access', () => {
    render(<SandboxedHtmlFrame src="/artifact" title="Artifact" />)
    const iframe = screen.getByTitle('Artifact')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('sets a no-referrer policy', () => {
    const { container } = render(<SandboxedHtmlFrame src="/artifact" title="Artifact" />)
    const iframe = container.querySelector('iframe')
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('remounts the iframe when reloadKey changes', () => {
    const { container, rerender } = render(
      <SandboxedHtmlFrame src="/artifact" title="Artifact" reloadKey={1} />,
    )
    const first = container.querySelector('iframe')
    rerender(<SandboxedHtmlFrame src="/artifact" title="Artifact" reloadKey={2} />)
    const second = container.querySelector('iframe')
    expect(second).not.toBe(first)
  })

  it('merges the className prop with the base classes', () => {
    const { container } = render(
      <SandboxedHtmlFrame src="/artifact" title="Artifact" className="h-[480px]" />,
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toHaveClass('block', 'w-full', 'border-0', 'bg-white', 'h-[480px]')
  })

  it('forwards a ref to the iframe element', () => {
    const ref = createRef<HTMLIFrameElement>()
    render(<SandboxedHtmlFrame ref={ref} src="/artifact" title="Artifact" />)
    const iframe = screen.getByTitle('Artifact')
    expect(ref.current).toBe(iframe)
    expect(ref.current).toBeInstanceOf(HTMLIFrameElement)
  })

  it('calls onLoad when the iframe loads', () => {
    const onLoad = vi.fn()
    render(<SandboxedHtmlFrame src="/artifact" title="Artifact" onLoad={onLoad} />)
    fireEvent.load(screen.getByTitle('Artifact'))
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('applies a height-only style while keeping the sandbox policy', () => {
    render(<SandboxedHtmlFrame src="/artifact" title="Artifact" style={{ height: 480 }} />)
    const iframe = screen.getByTitle('Artifact')
    expect(iframe).toHaveStyle({ height: '480px' })
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  })
})
