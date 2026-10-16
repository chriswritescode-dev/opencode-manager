import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
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
})
