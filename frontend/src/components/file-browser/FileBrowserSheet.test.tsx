import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { FileBrowserSheet } from './FileBrowserSheet'
import { FileBrowser, type FileBrowserHandle } from './FileBrowser'
import { renderWithProviders } from '@/test/render'
import { installWindowSize } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { FileInfo } from '@/types/files'

interface DirectoryFixture {
  children: string[]
  fileContent?: string
  delayMs?: number
}

function directoryInfo(path: string, fixture: DirectoryFixture): FileInfo {
  const name = path.split('/').pop() ?? path
  return {
    name,
    path,
    isDirectory: true,
    size: 0,
    lastModified: new Date('2026-01-01T00:00:00Z'),
    children: fixture.children.map((child) => {
      const childPath = `${path}/${child}`
      if (child.endsWith('.txt')) {
        return {
          name: child,
          path: childPath,
          isDirectory: false,
          size: 5,
          mimeType: 'text/plain',
          lastModified: new Date('2026-01-01T00:00:00Z'),
        }
      }
      return {
        name: child,
        path: childPath,
        isDirectory: true,
        size: 0,
        lastModified: new Date('2026-01-01T00:00:00Z'),
      }
    }),
  }
}

function fileApiRoutes(paths: Record<string, DirectoryFixture>, delayMs?: Record<string, number>): FetchRoute[] {
  return [
    {
      method: 'GET',
      path: '/api/files',
      respond: async (request): Promise<FetchRouteResult> => {
        const path = request.searchParams.get('path') ?? ''
        if (path.endsWith('.txt')) {
          return {
            json: {
              name: path.split('/').pop() ?? path,
              path,
              isDirectory: false,
              size: 5,
              mimeType: 'text/plain',
              content: btoa('hello'),
              lastModified: new Date('2026-01-01T00:00:00Z'),
            },
          }
        }
        const fixture = paths[path]
        if (!fixture) return { json: directoryInfo(path, { children: [] }) }
        const delay = delayMs?.[path]
        if (delay) {
          await new Promise((resolve) => {
            setTimeout(resolve, delay)
          })
        }
        return { json: directoryInfo(path, fixture) }
      },
    },
  ]
}

const navigationPaths = {
  test: { children: ['deep', 'notes.txt'], fileContent: 'hello' },
  'test/deep': { children: ['src'] },
  'test/deep/src': { children: [] },
  'test/notes.txt': { children: [] },
}

function renderSheet(routes: FetchRoute[] = fileApiRoutes(navigationPaths)) {
  const onClose = vi.fn()
  const onFileSelect = vi.fn()
  const result = renderWithProviders(
    <FileBrowserSheet isOpen onClose={onClose} basePath="test" onFileSelect={onFileSelect} />,
    { auth: false, theme: false, toaster: false, fetchRoutes: routes },
  )
  return { ...result, onClose, onFileSelect }
}

function sheetContainer(): HTMLElement {
  return screen.getByTestId('file-browser-sheet')
}

describe('FileBrowserSheet', () => {
  it('renders the file list while open', async () => {
    renderSheet()

    expect(await screen.findByPlaceholderText(/search/i)).toBeInTheDocument()
    expect(await screen.findByText('notes.txt')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    const { container } = renderWithProviders(
      <FileBrowserSheet isOpen={false} onClose={vi.fn()} />,
      { auth: false, theme: false, toaster: false, fetchRoutes: fileApiRoutes(navigationPaths) },
    )

    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('file-browser-sheet')).not.toBeInTheDocument()
  })

  it('closes from the header close button', async () => {
    const { onClose } = renderSheet()
    await screen.findByPlaceholderText(/search/i)

    fireEvent.click(screen.getByRole('button', { name: 'Close file browser' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', async () => {
    const { onClose } = renderSheet()
    await screen.findByPlaceholderText(/search/i)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('loads the base path and reports preview state when a file is opened', async () => {
    const { onFileSelect } = renderSheet()
    await screen.findByText('notes.txt')

    fireEvent.click(screen.getByText('notes.txt'))

    await waitFor(() => expect(onFileSelect).toHaveBeenCalledWith(expect.objectContaining({ path: 'test/notes.txt' })))
  })
})

describe('FileBrowser navigation', () => {
  function renderBrowser(routes: FetchRoute[] = fileApiRoutes(navigationPaths), initialSelectedFile?: string) {
    const ref = createRef<FileBrowserHandle>()
    const onDirectoryLoad = vi.fn()
    const result = renderWithProviders(
      <FileBrowser ref={ref} basePath="test" embedded initialSelectedFile={initialSelectedFile} onDirectoryLoad={onDirectoryLoad} />,
      { auth: false, theme: false, toaster: false, fetchRoutes: routes },
    )
    return { ...result, ref, onDirectoryLoad }
  }

  it('exposes the current path and canGoBack at the base path', async () => {
    const { ref } = renderBrowser()
    await screen.findByText('deep')

    expect(ref.current?.getCurrentPath()).toBe('test')
    expect(ref.current?.canGoBack()).toBe(false)
  })

  it('goes back to the parent directory after navigating deeper', async () => {
    const { ref } = renderBrowser()
    await screen.findByText('deep')

    fireEvent.click(screen.getByText('deep'))
    await screen.findByText('src')
    expect(ref.current?.getCurrentPath()).toBe('test/deep')
    expect(ref.current?.canGoBack()).toBe(true)

    act(() => {
      ref.current?.goBack()
    })

    await waitFor(() => expect(screen.getByText('deep')).toBeInTheDocument())
    expect(ref.current?.getCurrentPath()).toBe('test')
    expect(ref.current?.canGoBack()).toBe(false)
  })

  it('navigates into an initially selected directory even when the base listing resolves later', async () => {
    const { ref, onDirectoryLoad } = renderBrowser(fileApiRoutes(navigationPaths, { test: 50 }), 'test/deep')

    expect(await screen.findByText('src')).toBeInTheDocument()
    await waitFor(() => expect(ref.current?.getCurrentPath()).toBe('test/deep'))
    expect(screen.queryByText('deep')).not.toBeInTheDocument()
    expect(onDirectoryLoad).toHaveBeenLastCalledWith(expect.objectContaining({ currentPath: 'test/deep' }))
  })

  it('does not reload the current directory when the viewport becomes mobile', async () => {
    const routes = fileApiRoutes(navigationPaths)
    const { fetchFake, ref } = renderBrowser(routes)
    await screen.findByText('deep')
    const before = fetchFake.findRequests('GET', '/api/files').length

    installWindowSize(500)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(ref.current?.getCurrentPath()).toBe('test')
    expect(fetchFake.findRequests('GET', '/api/files')).toHaveLength(before)
  })
})

describe('FileBrowserSheet swipe dismissal', () => {
  function swipeRight(target: HTMLElement) {
    fireEvent.touchStart(target, { touches: [{ clientX: 10, clientY: 100 }] })
    fireEvent.touchMove(target, { touches: [{ clientX: 200, clientY: 100 }] })
    fireEvent.touchEnd(target, { touches: [{ clientX: 200, clientY: 100 }] })
  }

  it('closes the sheet from a right-edge swipe at the base path', async () => {
    installWindowSize(500)
    const { onClose } = renderSheet()
    await screen.findByText('deep')

    swipeRight(sheetContainer())

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('goes back from a right-edge swipe after navigating deeper', async () => {
    installWindowSize(500)
    const { onClose } = renderSheet()
    await screen.findByText('deep')

    fireEvent.click(screen.getByText('deep'))
    await screen.findByText('src')

    swipeRight(sheetContainer())

    await waitFor(() => expect(screen.getByText('deep')).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })
})
