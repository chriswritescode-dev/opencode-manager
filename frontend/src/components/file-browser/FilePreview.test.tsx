import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilePreview } from './FilePreview'
import type { FileInfo } from '@/types/files'

const OUTLINE_DARK_OVERRIDE = /(^|\s)dark:bg-input\/30(\s|$)/

function textFile(name: string, mimeType: string): FileInfo {
  return {
    name,
    path: `docker/${name}`,
    isDirectory: false,
    size: 32,
    mimeType,
    content: btoa('# heading\nline two'),
    lastModified: new Date('2026-07-28T09:12:40Z'),
  }
}

describe('FilePreview header buttons', () => {
  it('renders the active line wrap toggle as a primary button without the outline dark override', () => {
    render(<FilePreview file={textFile('Dockerfile', 'text/plain')} />)

    const active = screen.getByTitle('Disable line wrap')
    expect(active).toHaveClass('bg-primary', 'text-primary-foreground')
    expect(active.className).not.toMatch(OUTLINE_DARK_OVERRIDE)

    fireEvent.click(active)

    const inactive = screen.getByTitle('Enable line wrap')
    expect(inactive).not.toHaveClass('bg-primary')
    expect(inactive.className).toMatch(OUTLINE_DARK_OVERRIDE)
  })

  it('renders the active markdown preview toggle as a primary button without the outline dark override', () => {
    render(<FilePreview file={textFile('README.md', 'text/markdown')} />)

    const active = screen.getByTitle('Show raw markdown')
    expect(active).toHaveClass('bg-primary', 'text-primary-foreground')
    expect(active.className).not.toMatch(OUTLINE_DARK_OVERRIDE)
  })

  it('renders HTML files in a sandboxed iframe with a raw toggle', () => {
    render(<FilePreview file={textFile('report.html', 'text/html')} />)

    const frame = screen.getByTitle('report.html')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('src')).toContain('raw=true')
    expect(screen.getByTitle('Open HTML in new tab')).toHaveAttribute('target', '_blank')

    fireEvent.click(screen.getByTitle('Show raw HTML'))

    expect(screen.queryByTitle('report.html')).not.toBeInTheDocument()
    expect(screen.getByText('# heading')).toBeInTheDocument()
  })

  it('enters fullscreen from the header toggle and exits with the small close button', () => {
    render(<FilePreview file={textFile('Dockerfile', 'text/plain')} />)

    expect(screen.queryByTitle('Exit fullscreen')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Enter fullscreen'))

    expect(screen.queryByTitle('Enter fullscreen')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Exit fullscreen'))

    expect(screen.getByTitle('Enter fullscreen')).toBeInTheDocument()
  })

  it('closes a mobile preview from the on-top close button without a fullscreen toggle', () => {
    const onCloseModal = vi.fn()
    render(<FilePreview file={textFile('Dockerfile', 'text/plain')} isMobileModal onCloseModal={onCloseModal} />)

    expect(screen.queryByTitle('Enter fullscreen')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Close preview'))

    expect(onCloseModal).toHaveBeenCalled()
  })

  it('shows an on-top close button for a headerless mobile preview', () => {
    const onCloseModal = vi.fn()
    render(<FilePreview file={textFile('Dockerfile', 'text/plain')} hideHeader onCloseModal={onCloseModal} />)

    fireEvent.click(screen.getByTitle('Close preview'))

    expect(onCloseModal).toHaveBeenCalled()
  })

  it('opens relative markdown links in the file browser and external links in a new tab', () => {
    const onOpenFile = vi.fn()
    const file = {
      ...textFile('index.md', 'text/markdown'),
      content: btoa('- [ ] [report](sub/report.html)\n\n[site](https://example.com)'),
    }
    render(<FilePreview file={file} onOpenFile={onOpenFile} />)

    fireEvent.click(screen.getByRole('link', { name: 'report' }))
    expect(onOpenFile).toHaveBeenCalledWith('docker/sub/report.html')

    const external = screen.getByRole('link', { name: 'site' })
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('keeps the success and destructive tints on the edit actions in dark mode', () => {
    render(<FilePreview file={textFile('Dockerfile', 'text/plain')} />)

    const editButton = screen.getByTitle('Disable line wrap').nextElementSibling as HTMLElement
    fireEvent.click(editButton)

    const headerButtons = Array.from(screen.getByTitle('Disable line wrap').parentElement?.querySelectorAll('button') ?? [])
    const saveButton = headerButtons.find((button) => button.classList.contains('bg-success/10'))
    const cancelButton = headerButtons.find((button) => button.classList.contains('bg-destructive/10'))

    expect(saveButton).toHaveClass('bg-success/10', 'border-success', 'dark:hover:bg-success/20')
    expect(cancelButton).toHaveClass('bg-destructive/10', 'border-destructive', 'dark:hover:bg-destructive/20')
    expect(saveButton.className).not.toMatch(OUTLINE_DARK_OVERRIDE)
    expect(cancelButton.className).not.toMatch(OUTLINE_DARK_OVERRIDE)
  })
})
