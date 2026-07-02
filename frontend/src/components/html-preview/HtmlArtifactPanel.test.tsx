import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { HtmlArtifactPanel } from './HtmlArtifactPanel'
import type { HtmlArtifact } from '@/lib/htmlArtifacts'

vi.mock('@/api/files', () => ({
  getFilePreviewUrl: (path: string) => `/api/files/preview/${encodeURIComponent(path)}`,
}))

function createInlineArtifact(overrides?: Partial<HtmlArtifact>): HtmlArtifact {
  return {
    id: 'test-1',
    title: 'Test Preview',
    source: 'inline',
    html: '<h1>Hello World</h1>',
    ...overrides,
  }
}

function createFileArtifact(overrides?: Partial<HtmlArtifact>): HtmlArtifact {
  return {
    id: 'test-2',
    title: 'File Preview',
    source: 'file',
    path: 'my-repo/dist/index.html',
    ...overrides,
  }
}

function createDevServerArtifact(overrides?: Partial<HtmlArtifact>): HtmlArtifact {
  return {
    id: 'test-3',
    title: 'App Preview',
    source: 'devserver',
    previewUrl: 'http://manager.example:3056/',
    ...overrides,
  }
}

describe('HtmlArtifactPanel', () => {
  it('renders inline artifact with srcdoc and sandbox attribute', () => {
    const artifact = createInlineArtifact()
    render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    const iframe = screen.getByTitle('Test Preview')
    expect(iframe).toBeInTheDocument()
    expect(iframe.getAttribute('srcdoc')).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
    expect(iframe.getAttribute('srcdoc')).toContain('<h1>Hello World</h1>')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  })

  it('renders file artifact iframe with src pointing to preview API', () => {
    const artifact = createFileArtifact()
    render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    const iframe = screen.getByTitle('File Preview')
    expect(iframe).toBeInTheDocument()
    expect(iframe).toHaveAttribute('src')
    expect(iframe.getAttribute('src')).toContain('/api/files/preview/')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
  })

  it('does not include allow-same-origin in sandbox', () => {
    const artifact = createInlineArtifact()
    render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    const iframe = screen.getByTitle('Test Preview')
    const sandbox = iframe.getAttribute('sandbox')
    expect(sandbox).not.toContain('allow-same-origin')
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    const artifact = createInlineArtifact()
    render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={onClose}
        onToggleFullscreen={() => {}}
      />,
    )

    const closeButton = screen.getByLabelText('Close preview')
    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders fullscreen toggle button on desktop', () => {
    const artifact = createInlineArtifact()
    render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    const toggleButton = screen.getByLabelText('Enter fullscreen')
    expect(toggleButton).toBeInTheDocument()
  })

  it('renders FullscreenSheet on mobile', () => {
    const artifact = createInlineArtifact()
    const { container } = render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={true}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    const sheetRoot = container.querySelector('.fixed.inset-0')
    expect(sheetRoot).toBeInTheDocument()
  })

  it('renders FullscreenSheet when isFullscreen is true (desktop)', () => {
    const artifact = createInlineArtifact()
    const { container } = render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={true}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    const sheetRoot = container.querySelector('.fixed.inset-0')
    expect(sheetRoot).toBeInTheDocument()
  })

  it('returns null when artifact is null', () => {
    const { container } = render(
      <HtmlArtifactPanel
        artifact={null}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('shows desktop side-panel classes on desktop', () => {
    const artifact = createInlineArtifact()
    const { container } = render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    const panel = container.querySelector('.hidden.md\\:flex')
    expect(panel).toBeInTheDocument()
  })

  it('does not show desktop side panel on mobile', () => {
    const artifact = createInlineArtifact()
    const { container } = render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={true}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    const panel = container.querySelector('.hidden.md\\:flex')
    expect(panel).not.toBeInTheDocument()
  })

  it('renders devserver artifact iframe with src and widened sandbox', () => {
    const artifact = createDevServerArtifact()
    render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    const iframe = screen.getByTitle('App Preview')
    expect(iframe).toBeInTheDocument()
    expect(iframe).toHaveAttribute('src', 'http://manager.example:3056/')
    expect(iframe).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads',
    )
  })

  it('shows reload button for devserver artifact', () => {
    const artifact = createDevServerArtifact()
    render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    expect(screen.getByLabelText('Reload preview')).toBeInTheDocument()
  })

  it('shows reload button for file artifact', () => {
    const artifact = createFileArtifact()
    render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    expect(screen.getByLabelText('Reload preview')).toBeInTheDocument()
  })

  it('does not show reload button for inline artifact', () => {
    const artifact = createInlineArtifact()
    render(
      <HtmlArtifactPanel
        artifact={artifact}
        isFullscreen={false}
        isMobile={false}
        onClose={() => {}}
        onToggleFullscreen={() => {}}
      />,
    )

    expect(screen.queryByLabelText('Reload preview')).not.toBeInTheDocument()
  })
})
