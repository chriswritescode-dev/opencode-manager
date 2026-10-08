import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom'
import { FileBrowser } from './FileBrowser'
import type { FileInfo } from '@/types/files'
import * as useMobile from '../../hooks/useMobile'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

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

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFileFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').searchParams.get('path')
    if (path === 'repo/notes.txt') {
      return jsonResponse(fileInfo)
    }
    return jsonResponse(directoryInfo)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('FileBrowser compact', () => {
  it('renders a single full-width column without the desktop preview pane', async () => {
    const mobileSpy = vi.spyOn(useMobile, 'useMobile').mockReturnValue(false)
    stubFileFetch()

    try {
      render(<FileBrowser basePath="repo" embedded compact />, { wrapper: createWrapper() })

      expect(await screen.findByText('notes.txt')).toBeInTheDocument()
      expect(screen.queryByText('Select a file to preview')).not.toBeInTheDocument()

      const column = screen.getByPlaceholderText('Search').closest('.border-r')
      expect(column).toHaveClass('w-full')
      expect(column).not.toHaveClass('w-[30%]')
    } finally {
      mobileSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('shows the inline preview when a file is opened and returns to the list on close', async () => {
    const mobileSpy = vi.spyOn(useMobile, 'useMobile').mockReturnValue(false)
    stubFileFetch()

    try {
      render(<FileBrowser basePath="repo" embedded compact />, { wrapper: createWrapper() })

      fireEvent.click(await screen.findByText('notes.txt'))

      await waitFor(() => expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument())
      expect(screen.getByText('hello world')).toBeInTheDocument()
      expect(screen.getByTitle('Close preview')).toBeInTheDocument()

      fireEvent.click(screen.getByTitle('Close preview'))

      await waitFor(() => expect(screen.getByPlaceholderText('Search')).toBeInTheDocument())
      expect(screen.queryByText('hello world')).not.toBeInTheDocument()
    } finally {
      mobileSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('keeps the split desktop layout when compact is not set', async () => {
    const mobileSpy = vi.spyOn(useMobile, 'useMobile').mockReturnValue(false)
    stubFileFetch()

    try {
      render(<FileBrowser basePath="repo" embedded />, { wrapper: createWrapper() })

      expect(await screen.findByText('notes.txt')).toBeInTheDocument()
      expect(screen.getByText('Select a file to preview')).toBeInTheDocument()
    } finally {
      mobileSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
