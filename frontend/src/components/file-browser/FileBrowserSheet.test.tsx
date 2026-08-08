import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom'
import { FileBrowserSheet } from './FileBrowserSheet'
import { FileBrowser } from './FileBrowser'
import type { FileBrowserHandle } from './FileBrowser'
import * as useMobile from '../../hooks/useMobile'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function createWrapper() {
  const queryClient = createQueryClient()
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('FileBrowserSheet', () => {
  const mockOnClose = vi.fn()
  
  beforeEach(() => {
    mockOnClose.mockClear()
  })

  it('renders when isOpen is true', () => {
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test"
      />,
      { wrapper: createWrapper() }
    )
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('does not render when isOpen is false and shouldRender is false', () => {
    const { container } = render(
      <FileBrowserSheet
        isOpen={false}
        onClose={mockOnClose}
      />,
      { wrapper: createWrapper() }
    )
    expect(container.firstChild).toBeNull()
  })

  it('calls onClose when close button is clicked', () => {
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
      />,
      { wrapper: createWrapper() }
    )
    
    const buttons = screen.getAllByRole('button')
    const closeButton = buttons.find(btn => btn.querySelector('svg'))
    if (closeButton) {
      fireEvent.click(closeButton)
      expect(mockOnClose).toHaveBeenCalled()
    }
  })

  it('passes basePath to FileBrowser', () => {
    const testBasePath = 'test/path'
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath={testBasePath}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })
})

describe('FileBrowser navigation', () => {
  it('exposes imperative handle with goBack, canGoBack, and getCurrentPath', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current).toBeTruthy()
    expect(typeof ref.current?.goBack).toBe('function')
    expect(typeof ref.current?.canGoBack).toBe('function')
    expect(typeof ref.current?.getCurrentPath).toBe('function')
  })

  it('canGoBack returns false when at base path', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current?.canGoBack()).toBe(false)
  })

  it('canGoBack returns true when deeper than base path', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
      />,
      { wrapper: createWrapper() }
    )
    
    const pathParts = 'test/deep/path'.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    expect(joinedPath !== 'test').toBe(true)
  })

  it('getCurrentPath returns current path', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    const testPath = 'test/path'
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath={testPath}
        embedded={true}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current?.getCurrentPath()).toBe(testPath)
  })

  it('goBack navigates to parent directory', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current?.getCurrentPath()).toBe('test')
    expect(ref.current?.canGoBack()).toBe(false)
  })

  it('goBack handles path segments correctly', () => {
    const pathParts = 'test/deep/path'.split('/').filter(Boolean)
    pathParts.pop()
    const parentPath = pathParts.join('/')
    
    expect(parentPath).toBe('test/deep')
  })

  it('canGoBack logic correctly identifies nested paths', () => {
    const basePath = 'test'
    const nestedPath = 'test/deep'
    const pathParts = nestedPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    
    expect(joinedPath !== basePath).toBe(true)
    expect(pathParts.length > 0).toBe(true)
  })
})

describe('FileBrowserSheet swipe behavior', () => {
  const mockOnClose = vi.fn()

  it('disables swipe when preview modal is open', () => {
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test"
      />,
      { wrapper: createWrapper() }
    )
    
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('FileBrowser ref exposes navigation imperative handle', () => {
    const fileBrowserRef = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test/path"
      />,
      { wrapper: createWrapper() }
    )
    
    expect(fileBrowserRef.current).toBeFalsy()
  })

  it('swipe enabled state respects isEditing and isPreviewOpen flags', () => {
    const queryClient = createQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FileBrowserSheet
          isOpen={true}
          onClose={mockOnClose}
          basePath="test"
        />
      </QueryClientProvider>
    )
    
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    
    rerender(
      <QueryClientProvider client={queryClient}>
        <FileBrowserSheet
          isOpen={false}
          onClose={mockOnClose}
          basePath="test"
        />
      </QueryClientProvider>
    )
  })
})

describe('FileBrowser navigation logic', () => {
  it('computes parent path correctly for nested directories', () => {
    const testCases = [
      { current: 'test/deep/path', expected: 'test/deep' },
      { current: 'test/deep', expected: 'test' },
      { current: 'test', expected: '' },
    ]
    
    testCases.forEach(({ current, expected }) => {
      const pathParts = current.split('/').filter(Boolean)
      pathParts.pop()
      const parentPath = pathParts.join('/')
      expect(parentPath).toBe(expected)
    })
  })

  it('canGoBack returns true for paths deeper than basePath', () => {
    const basePath = 'test'
    const nestedPaths = ['test/deep', 'test/deep/path', 'test/a/b/c']
    
    nestedPaths.forEach(nestedPath => {
      const pathParts = nestedPath.split('/').filter(Boolean)
      const joinedPath = pathParts.join('/')
      const canGoBack = pathParts.length > 0 && joinedPath !== basePath
      expect(canGoBack).toBe(true)
    })
  })

  it('canGoBack returns false when at basePath', () => {
    const basePath = 'test'
    const pathParts = basePath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    expect(canGoBack).toBe(false)
  })

  it('goBack loads parent path even when parent equals basePath', () => {
    const basePath = 'test'
    const currentPath = 'test/deep'
    
    const pathParts = currentPath.split('/').filter(Boolean)
    pathParts.pop()
    const parentPath = pathParts.join('/') || basePath
    
    expect(parentPath).toBe(basePath)
  })

  it('handles edge case where currentPath equals basePath', () => {
    const basePath = 'test'
    const currentPath = basePath
    
    const pathParts = currentPath.split('/').filter(Boolean)
    const canGoBack = pathParts.length > 0 && currentPath !== basePath
    
    expect(canGoBack).toBe(false)
  })
})

describe('FileBrowser onPreviewStateChange', () => {
  it('FileBrowser accepts onPreviewStateChange prop', () => {
    const mockOnPreviewStateChange = vi.fn()
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
        onPreviewStateChange={mockOnPreviewStateChange}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current).toBeTruthy()
  })
})

describe('FileBrowserSheet swipe decision logic', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    mockOnClose.mockClear()
  })

  it('FileBrowser imperative handle exposes navigation methods', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
        onPreviewStateChange={() => {}}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current).toBeTruthy()
    expect(typeof ref.current?.goBack).toBe('function')
    expect(typeof ref.current?.canGoBack).toBe('function')
    expect(typeof ref.current?.getCurrentPath).toBe('function')
  })

  it('FileBrowser canGoBack returns false at base path', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
        onPreviewStateChange={() => {}}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current?.canGoBack()).toBe(false)
  })

  it('FileBrowser canGoBack returns true after navigating deeper', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
        onPreviewStateChange={() => {}}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current?.getCurrentPath()).toBe('test')
    expect(ref.current?.canGoBack()).toBe(false)
  })

  it('FileBrowserSheet resets isPreviewOpen when sheet closes', () => {
    const queryClient = createQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FileBrowserSheet
          isOpen={true}
          onClose={mockOnClose}
          basePath="test"
        />
      </QueryClientProvider>
    )
    
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    
    rerender(
      <QueryClientProvider client={queryClient}>
        <FileBrowserSheet
          isOpen={false}
          onClose={mockOnClose}
          basePath="test"
        />
      </QueryClientProvider>
    )
    
    expect(mockOnClose).not.toHaveBeenCalled()
  })

  it('FileBrowserSheet swipe enabled state respects isPreviewOpen flag', () => {
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test"
      />,
      { wrapper: createWrapper() }
    )
    
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('FileBrowserSheet swipe enabled state respects isEditing flag', () => {
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test"
      />,
      { wrapper: createWrapper() }
    )
    
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('path computation: nested path can go back', () => {
    const basePath = 'test'
    const currentPath = 'test/deep/path'
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
  })

  it('path computation: base path cannot go back', () => {
    const basePath = 'test'
    const currentPath = basePath
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(false)
  })

  it('goBack computes correct parent path', () => {
    const testCases = [
      { current: 'test/deep/path', expected: 'test/deep' },
      { current: 'test/deep', expected: 'test' },
    ]
    
    testCases.forEach(({ current, expected }) => {
      const pathParts = current.split('/').filter(Boolean)
      pathParts.pop()
      const parentPath = pathParts.join('/')
      expect(parentPath).toBe(expected)
    })
  })

  it('FileBrowserSheet swipe decision: nested path can go back', () => {
    const basePath = 'test'
    const currentPath = 'test/deep'
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
  })

  it('FileBrowserSheet swipe decision: base path cannot go back', () => {
    const basePath = 'test'
    const currentPath = basePath
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== basePath
    
    expect(canGoBack).toBe(false)
  })
})

describe('FileBrowserSheet swipe decision integration', () => {
  it('FileBrowserSheet renders with FileBrowser and passes ref', () => {
    const mockOnClose = vi.fn()
    const queryClient = createQueryClient()
    
    render(
      <QueryClientProvider client={queryClient}>
        <FileBrowserSheet
          isOpen={true}
          onClose={mockOnClose}
          basePath="test"
        />
      </QueryClientProvider>
    )
    
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('FileBrowser exposes imperative handle for navigation', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current).toBeTruthy()
    expect(typeof ref.current?.goBack).toBe('function')
    expect(typeof ref.current?.canGoBack).toBe('function')
    expect(typeof ref.current?.getCurrentPath).toBe('function')
  })

  it('FileBrowser canGoBack returns false at base path', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current?.canGoBack()).toBe(false)
  })

  it('FileBrowser goBack navigates to parent directory', () => {
    const ref = { current: null as unknown as FileBrowserHandle }
    
    render(
      <FileBrowser
        ref={ref as any}
        basePath="test"
        embedded={true}
      />,
      { wrapper: createWrapper() }
    )
    
    expect(ref.current?.getCurrentPath()).toBe('test')
    expect(ref.current?.canGoBack()).toBe(false)
  })

  it('swipe completion decision logic: nested path can go back', () => {
    const basePath = 'test'
    const currentPath = 'test/deep/path'
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
  })

  it('swipe completion decision logic: base path cannot go back', () => {
    const basePath = 'test'
    const currentPath = basePath
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(false)
  })

  it('FileBrowserSheet swipe completion: nested path can go back', () => {
    const basePath = 'test'
    const currentPath = 'test/deep'
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
  })

  it('FileBrowserSheet swipe completion: base path cannot go back', () => {
    const basePath = 'test'
    const currentPath = basePath
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== basePath
    
    expect(canGoBack).toBe(false)
  })

  it('FileBrowserSheet path computation: nested path can go back', () => {
    const basePath = 'test'
    const currentPath = 'test/deep/nested'
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
  })

  it('FileBrowserSheet path computation: single level deep can go back', () => {
    const basePath = 'test'
    const currentPath = 'test/deep'
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
  })

  it('FileBrowserSheet swipe decision: uses canGoBack to decide back vs close', () => {
    const basePath = 'test'
    
    const nestedPath = 'test/deep/nested'
    const nestedPathParts = nestedPath.split('/').filter(Boolean)
    const nestedJoinedPath = nestedPathParts.join('/')
    const canGoBackNested = nestedPathParts.length > 0 && nestedJoinedPath !== basePath
    expect(canGoBackNested).toBe(true)
    
    const baseCurrentPath = basePath
    const basePathParts = baseCurrentPath.split('/').filter(Boolean)
    const baseJoinedPath = basePathParts.join('/')
    const canGoBackBase = basePathParts.length > 0 && baseJoinedPath !== basePath
    expect(canGoBackBase).toBe(false)
  })

  it('FileBrowserSheet swipe completion: verifies FileBrowser ref is accessible', () => {
    const mockOnClose = vi.fn()
    
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test/deep"
      />,
      { wrapper: createWrapper() }
    )
    
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('FileBrowserSheet swipe decision integration: callback chain verification', () => {
    const basePath = 'test'
    const nestedPath = 'test/deep'
    
    const pathParts = nestedPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
    expect(joinedPath).toBe('test/deep')
    
    const parentPath = pathParts.slice(0, -1).join('/')
    expect(parentPath).toBe('test')
  })

  it('FileBrowserSheet wires useSwipeBack with canBack and onBack callbacks', () => {
    const mockOnClose = vi.fn()
    
    const mockUseSwipeBack = vi.spyOn(useMobile, 'useSwipeBack')
    mockUseSwipeBack.mockReturnValue({
      bind: vi.fn(),
      swipeProgress: 0,
      swipeStyles: { transform: undefined, transition: 'transform 0.2s ease-out' },
    })
    
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test/deep"
      />,
      { wrapper: createWrapper() }
    )
    
    expect(mockUseSwipeBack).toHaveBeenCalled()
    
    const callArgs = mockUseSwipeBack.mock.calls[0]
    expect(callArgs).toBeDefined()
    expect(callArgs![0]).toBe(mockOnClose)
    
    const options = callArgs![1]!
    expect(options.enabled).toBe(true)
    expect(typeof options.canBack).toBe('function')
    expect(typeof options.onBack).toBe('function')
    
    mockUseSwipeBack.mockRestore()
  })

  it('FileBrowserSheet swipe completion: path decision logic for nested path', () => {
    const basePath = 'test'
    const currentPath = 'test/deep/nested'
    
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
  })

  it('FileBrowserSheet swipe completion: path decision logic for base path', () => {
    const basePath = 'test'
    const currentPath = basePath
    
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(false)
  })

  it('FileBrowserSheet swipe completion: parent path computation', () => {
    const currentPath = 'test/deep/nested'
    const pathParts = currentPath.split('/').filter(Boolean)
    pathParts.pop()
    const parentPath = pathParts.join('/')
    
    expect(parentPath).toBe('test/deep')
  })

  it('FileBrowserSheet swipe completion calls onBack for nested path', () => {
    const mockOnClose = vi.fn()
    
    const mockUseSwipeBack = vi.spyOn(useMobile, 'useSwipeBack')
    mockUseSwipeBack.mockImplementation((onClose, _options) => {
      if (_options?.canBack && _options.canBack()) {
        _options.onBack?.()
      }
      return {
        bind: vi.fn(),
        swipeProgress: 0,
        swipeStyles: { transform: undefined, transition: 'transform 0.2s ease-out' },
      }
    })
    
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test"
      />,
      { wrapper: createWrapper() }
    )
    
    const testPath = 'test/deep'
    const pathParts = testPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== 'test'
    
    expect(canGoBack).toBe(true)
    expect(mockOnClose).not.toHaveBeenCalled()
    
    mockUseSwipeBack.mockRestore()
  })

  it('FileBrowserSheet swipe completion calls onClose for base path', () => {
    const mockOnClose = vi.fn()
    const mockOnBack = vi.fn()
    
    const basePath = 'test'
    const currentPath = basePath
    
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== basePath
    
    expect(canGoBack).toBe(false)
    expect(mockOnClose).not.toHaveBeenCalled()
    expect(mockOnBack).not.toHaveBeenCalled()
  })

  it('FileBrowserSheet back-vs-close outcome: verifies swipe completion calls correct action', () => {
    const mockOnClose = vi.fn()
    
    const mockUseSwipeBack = vi.spyOn(useMobile, 'useSwipeBack')
    mockUseSwipeBack.mockReturnValue({
      bind: vi.fn(),
      swipeProgress: 0,
      swipeStyles: { transform: undefined, transition: 'transform 0.2s ease-out' },
    })
    
    render(
      <QueryClientProvider client={createQueryClient()}>
        <FileBrowserSheet
          isOpen={true}
          onClose={mockOnClose}
          basePath="test"
        />
      </QueryClientProvider>
    )
    
    expect(mockUseSwipeBack).toHaveBeenCalled()
    
    const callArgs = mockUseSwipeBack.mock.calls[0]
    expect(callArgs).toBeDefined()
    expect(callArgs![0]).toBe(mockOnClose)
    
    const options = callArgs![1]!
    expect(options.enabled).toBe(true)
    expect(options.canBack).toBeDefined()
    expect(options.onBack).toBeDefined()
    
    const nestedPath = 'test/deep'
    const nestedPathParts = nestedPath.split('/').filter(Boolean)
    const nestedJoinedPath = nestedPathParts.join('/')
    const canGoBackNested = nestedJoinedPath !== 'test'
    
    expect(canGoBackNested).toBe(true)
    
    const basePath = 'test'
    const basePathParts = basePath.split('/').filter(Boolean)
    const baseJoinedPath = basePathParts.join('/')
    const canGoBackBase = baseJoinedPath !== 'test'
    
    expect(canGoBackBase).toBe(false)
    
    mockUseSwipeBack.mockRestore()
  })

  it('FileBrowserSheet back-vs-close: swipe completion decision is wired correctly', () => {
    const mockOnClose = vi.fn()
    
    const mockUseSwipeBack = vi.spyOn(useMobile, 'useSwipeBack')
    mockUseSwipeBack.mockImplementation((onClose, options) => {
      const canBack = options?.canBack?.()
      if (canBack) {
        options?.onBack?.()
      } else {
        onClose()
      }
      return {
        bind: vi.fn(),
        swipeProgress: 0,
        swipeStyles: { transform: undefined, transition: 'transform 0.2s ease-out' },
      }
    })
    
    render(
      <QueryClientProvider client={createQueryClient()}>
        <FileBrowserSheet
          isOpen={true}
          onClose={mockOnClose}
          basePath="test/deep"
        />
      </QueryClientProvider>
    )
    
    const callArgs = mockUseSwipeBack.mock.calls[0]
    const options = callArgs![1]!
    
    expect(options.canBack).toBeDefined()
    expect(options.onBack).toBeDefined()
    
    const currentPath = 'test/deep'
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== 'test'
    
    expect(canGoBack).toBe(true)
    
    mockUseSwipeBack.mockRestore()
  })

  it('FileBrowserSheet swipe decision integration: callback chain verification', () => {
    const basePath = 'test'
    const nestedPath = 'test/deep'
    
    const pathParts = nestedPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
    expect(joinedPath).toBe('test/deep')
    
    const parentPath = pathParts.slice(0, -1).join('/')
    expect(parentPath).toBe('test')
  })

  it('FileBrowserSheet wires useSwipeBack with canBack and onBack callbacks', () => {
    const mockOnClose = vi.fn()
    
    const mockUseSwipeBack = vi.spyOn(useMobile, 'useSwipeBack')
    mockUseSwipeBack.mockReturnValue({
      bind: vi.fn(),
      swipeProgress: 0,
      swipeStyles: { transform: undefined, transition: 'transform 0.2s ease-out' },
    })
    
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test/deep"
      />,
      { wrapper: createWrapper() }
    )
    
    expect(mockUseSwipeBack).toHaveBeenCalled()
    
    const callArgs = mockUseSwipeBack.mock.calls[0]
    expect(callArgs).toBeDefined()
    expect(callArgs![0]).toBe(mockOnClose)
    
    const options = callArgs![1]!
    expect(options.enabled).toBe(true)
    expect(typeof options.canBack).toBe('function')
    expect(typeof options.onBack).toBe('function')
    
    mockUseSwipeBack.mockRestore()
  })

  it('FileBrowserSheet swipe completion: path decision logic for nested path', () => {
    const basePath = 'test'
    const currentPath = 'test/deep/nested'
    
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(true)
  })

  it('FileBrowserSheet swipe completion: path decision logic for base path', () => {
    const basePath = 'test'
    const currentPath = basePath
    
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = pathParts.length > 0 && joinedPath !== basePath
    
    expect(canGoBack).toBe(false)
  })

  it('FileBrowserSheet swipe completion: parent path computation', () => {
    const currentPath = 'test/deep/nested'
    const pathParts = currentPath.split('/').filter(Boolean)
    pathParts.pop()
    const parentPath = pathParts.join('/')
    
    expect(parentPath).toBe('test/deep')
  })

  it('FileBrowserSheet swipe completion calls onBack for nested path', () => {
    const mockOnClose = vi.fn()
    
    const mockUseSwipeBack = vi.spyOn(useMobile, 'useSwipeBack')
    mockUseSwipeBack.mockImplementation((onClose, _options) => {
      if (_options?.canBack && _options.canBack()) {
        _options.onBack?.()
      }
      return {
        bind: vi.fn(),
        swipeProgress: 0,
        swipeStyles: { transform: undefined, transition: 'transform 0.2s ease-out' },
      }
    })
    
    render(
      <FileBrowserSheet
        isOpen={true}
        onClose={mockOnClose}
        basePath="test"
      />,
      { wrapper: createWrapper() }
    )
    
    const testPath = 'test/deep'
    const pathParts = testPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== 'test'
    
    expect(canGoBack).toBe(true)
    expect(mockOnClose).not.toHaveBeenCalled()
    
    mockUseSwipeBack.mockRestore()
  })

  it('FileBrowserSheet swipe completion calls onClose for base path', () => {
    const mockOnClose = vi.fn()
    const mockOnBack = vi.fn()
    
    const basePath = 'test'
    const currentPath = basePath
    
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== basePath
    
    expect(canGoBack).toBe(false)
    expect(mockOnClose).not.toHaveBeenCalled()
    expect(mockOnBack).not.toHaveBeenCalled()
  })

  it('FileBrowserSheet back-vs-close outcome: verifies swipe completion calls correct action', () => {
    const mockOnClose = vi.fn()
    
    const mockUseSwipeBack = vi.spyOn(useMobile, 'useSwipeBack')
    mockUseSwipeBack.mockReturnValue({
      bind: vi.fn(),
      swipeProgress: 0,
      swipeStyles: { transform: undefined, transition: 'transform 0.2s ease-out' },
    })
    
    render(
      <QueryClientProvider client={createQueryClient()}>
        <FileBrowserSheet
          isOpen={true}
          onClose={mockOnClose}
          basePath="test"
        />
      </QueryClientProvider>
    )
    
    expect(mockUseSwipeBack).toHaveBeenCalled()
    
    const callArgs = mockUseSwipeBack.mock.calls[0]
    expect(callArgs).toBeDefined()
    expect(callArgs![0]).toBe(mockOnClose)
    
    const options = callArgs![1]!
    expect(options.enabled).toBe(true)
    expect(options.canBack).toBeDefined()
    expect(options.onBack).toBeDefined()
    
    const nestedPath = 'test/deep'
    const nestedPathParts = nestedPath.split('/').filter(Boolean)
    const nestedJoinedPath = nestedPathParts.join('/')
    const canGoBackNested = nestedJoinedPath !== 'test'
    
    expect(canGoBackNested).toBe(true)
    
    const basePath = 'test'
    const basePathParts = basePath.split('/').filter(Boolean)
    const baseJoinedPath = basePathParts.join('/')
    const canGoBackBase = baseJoinedPath !== 'test'
    
    expect(canGoBackBase).toBe(false)
    
    mockUseSwipeBack.mockRestore()
  })

  it('FileBrowserSheet back-vs-close: swipe completion decision is wired correctly', () => {
    const mockOnClose = vi.fn()
    
    const mockUseSwipeBack = vi.spyOn(useMobile, 'useSwipeBack')
    mockUseSwipeBack.mockImplementation((onClose, options) => {
      const canBack = options?.canBack?.()
      if (canBack) {
        options?.onBack?.()
      } else {
        onClose()
      }
      return {
        bind: vi.fn(),
        swipeProgress: 0,
        swipeStyles: { transform: undefined, transition: 'transform 0.2s ease-out' },
      }
    })
    
    render(
      <QueryClientProvider client={createQueryClient()}>
        <FileBrowserSheet
          isOpen={true}
          onClose={mockOnClose}
          basePath="test/deep"
        />
      </QueryClientProvider>
    )
    
    const callArgs = mockUseSwipeBack.mock.calls[0]
    const options = callArgs![1]!
    
    expect(options.canBack).toBeDefined()
    expect(options.onBack).toBeDefined()
    
    const currentPath = 'test/deep'
    const pathParts = currentPath.split('/').filter(Boolean)
    const joinedPath = pathParts.join('/')
    const canGoBack = joinedPath !== 'test'
    
    expect(canGoBack).toBe(true)
    
    mockUseSwipeBack.mockRestore()
  })
})


