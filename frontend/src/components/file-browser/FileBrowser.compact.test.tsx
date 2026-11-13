import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { FileBrowser } from './FileBrowser'
import { renderWithProviders } from '@/test/render'
import type { FileInfo } from '@/types/files'
import type { FetchRoute } from '@/test/fetchFake'

const fileInfo: FileInfo = {
  name: 'notes.txt',
  path: 'repo/notes.txt',
  isDirectory: false,
  size: 12,
  mimeType: 'text/plain',
  content: btoa('hello world'),
  lastModified: new Date('2026-01-01T00:00:00Z'),
}

const directoryInfo: FileInfo = {
  name: 'repo',
  path: 'repo',
  isDirectory: true,
  size: 0,
  lastModified: new Date('2026-01-01T00:00:00Z'),
  children: [
    {
      name: 'notes.txt',
      path: 'repo/notes.txt',
      isDirectory: false,
      size: 12,
      mimeType: 'text/plain',
      lastModified: new Date('2026-01-01T00:00:00Z'),
    },
  ],
}

const fileRoutes: FetchRoute[] = [
  {
    method: 'GET',
    path: '/api/files',
    respond: (request) => ({
      json: request.searchParams.get('path') === 'repo/notes.txt' ? fileInfo : directoryInfo,
    }),
  },
]

function renderBrowser(props: { compact?: boolean } = {}) {
  return renderWithProviders(<FileBrowser basePath="repo" embedded {...props} />, {
    auth: false,
    theme: false,
    toaster: false,
    fetchRoutes: fileRoutes,
  })
}

describe('FileBrowser compact', () => {
  it('renders a single full-width column without the desktop preview pane', async () => {
    renderBrowser({ compact: true })

    expect(await screen.findByText('notes.txt')).toBeInTheDocument()
    expect(screen.queryByText('Select a file to preview')).not.toBeInTheDocument()

    const column = screen.getByPlaceholderText('Search').closest('.border-r')
    expect(column).toHaveClass('w-full')
    expect(column).not.toHaveClass('w-[30%]')
  })

  it('shows the inline preview when a file is opened and returns to the list on close', async () => {
    renderBrowser({ compact: true })

    fireEvent.click(await screen.findByText('notes.txt'))

    await waitFor(() => expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument())
    expect(screen.getByText('hello world')).toBeInTheDocument()
    expect(screen.getByTitle('Close preview')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Close preview'))

    await waitFor(() => expect(screen.getByPlaceholderText('Search')).toBeInTheDocument())
    expect(screen.queryByText('hello world')).not.toBeInTheDocument()
  })

  it('keeps the split desktop layout when compact is not set', async () => {
    renderBrowser()

    expect(await screen.findByText('notes.txt')).toBeInTheDocument()
    expect(screen.getByText('Select a file to preview')).toBeInTheDocument()
  })
})
