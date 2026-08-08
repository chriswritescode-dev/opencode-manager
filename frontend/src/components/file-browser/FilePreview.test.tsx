import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { FilePreview } from './FilePreview'
import type { FileInfo } from '@/types/files'

vi.mock('@/api/files', () => ({
  getFileApiUrl: (path: string) => `/api/files?path=${encodeURIComponent(path)}`,
  getFilePreviewUrl: (path: string) => {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    return `/api/files/preview/${encodedPath}`
  },
}))

vi.mock('@/components/ui/virtualized-text-view', () => ({
  VirtualizedTextView: vi.fn(() => <div data-testid="virtualized-text-view" />),
}))

function htmlFile(content: string, overrides?: Partial<FileInfo>): FileInfo {
  return {
    name: 'dashboard.html',
    path: 'test-repo/dashboard.html',
    isDirectory: false,
    size: content.length,
    mimeType: 'text/html',
    content: btoa(content),
    lastModified: new Date(),
    ...overrides,
  }
}

function textFile(name: string, content: string, mimeType: string): FileInfo {
  return {
    name,
    path: `test-repo/${name}`,
    isDirectory: false,
    size: content.length,
    mimeType,
    content: btoa(content),
    lastModified: new Date(),
  }
}

describe('FilePreview - HTML preview', () => {
  it('renders HTML preview iframe by default for .html file', () => {
    render(<FilePreview file={htmlFile('<h1>Dashboard</h1>')} />)

    const iframe = screen.getByTitle('HTML preview: dashboard.html')
    expect(iframe).toBeInTheDocument()
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
    expect(iframe.getAttribute('src')).toContain('/api/files/preview/test-repo/dashboard.html')
  })

  it('toggles to source view when code button is clicked', () => {
    render(<FilePreview file={htmlFile('<h1>Dashboard</h1>')} />)

    const toggleButton = screen.getByTitle('Show HTML source')
    expect(toggleButton).toBeInTheDocument()

    fireEvent.click(toggleButton)

    expect(screen.queryByTitle('HTML preview: dashboard.html')).not.toBeInTheDocument()
    expect(screen.getByText('<h1>Dashboard</h1>')).toBeInTheDocument()
  })

  it('toggles back to preview when eye button is clicked from source view', () => {
    render(<FilePreview file={htmlFile('<h1>Dashboard</h1>')} />)

    const showSourceButton = screen.getByTitle('Show HTML source')
    fireEvent.click(showSourceButton)
    expect(screen.queryByTitle('HTML preview: dashboard.html')).not.toBeInTheDocument()

    const showPreviewButton = screen.getByTitle('Preview rendered HTML')
    expect(showPreviewButton).toBeInTheDocument()

    fireEvent.click(showPreviewButton)

    const iframe = screen.getByTitle('HTML preview: dashboard.html')
    expect(iframe).toBeInTheDocument()
  })

  it('renders HTML preview for .htm file', () => {
    render(<FilePreview file={htmlFile('<p>HTM test</p>', { name: 'test.htm', path: 'test-repo/test.htm', mimeType: 'text/html' })} />)

    const iframe = screen.getByTitle('HTML preview: test.htm')
    expect(iframe).toBeInTheDocument()
    expect(iframe.getAttribute('src')).toContain('/api/files/preview/test-repo/test.htm')
  })

  it('does not show HTML preview toggle for non-HTML text file', () => {
    render(<FilePreview file={textFile('readme.txt', 'Hello world', 'text/plain')} />)

    expect(screen.queryByTitle('Show HTML source')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Preview rendered HTML')).not.toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('preserves markdown preview behavior for .md files', () => {
    render(<FilePreview file={textFile('readme.md', '# Hello', 'text/markdown')} />)

    const toggleButton = screen.getByTitle('Show raw markdown')
    expect(toggleButton).toBeInTheDocument()
  })
})
