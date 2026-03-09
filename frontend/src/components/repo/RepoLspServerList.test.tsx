import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RepoLspServerList } from './RepoLspServerList'
import type { LspStatus } from '@/api/opencode'

describe('RepoLspServerList', () => {
  describe('loading state', () => {
    it('should show loading spinner when isLoading is true', () => {
      const { container } = render(<RepoLspServerList isLoading={true} data={undefined} />)

      expect(screen.getByText('Loading...')).toBeInTheDocument()
      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('should show empty message when no servers', () => {
      render(<RepoLspServerList isLoading={false} data={[]} />)

      expect(screen.getByText('No LSP servers active')).toBeInTheDocument()
      expect(screen.getByText(/LSP servers will activate automatically/)).toBeInTheDocument()
    })

    it('should show empty message when data is undefined', () => {
      render(<RepoLspServerList isLoading={false} data={undefined} />)

      expect(screen.getByText('No LSP servers active')).toBeInTheDocument()
    })
  })

  describe('server list', () => {
    it('should render all servers', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'typescript-language-server', status: 'connected', root: '/project' },
        { id: '2', name: 'python-lsp-server', status: 'error', root: '/project/src' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('Typescript language server')).toBeInTheDocument()
      expect(screen.getByText('Python lsp server')).toBeInTheDocument()
    })

    it('should format server names correctly with hyphens', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'typescript-language-server', status: 'connected', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('Typescript language server')).toBeInTheDocument()
    })

    it('should format server names correctly with underscores', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'python_lsp_server', status: 'connected', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('Python lsp server')).toBeInTheDocument()
    })

    it('should capitalize first letter of server name', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'rust-analyzer', status: 'connected', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('Rust analyzer')).toBeInTheDocument()
    })

    it('should show Active badge for connected servers', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'typescript-language-server', status: 'connected', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('should show Error badge for error servers', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'typescript-language-server', status: 'error', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('Error')).toBeInTheDocument()
    })

    it('should display server root path', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'typescript-language-server', status: 'connected', root: '/project/src' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('/project/src')).toBeInTheDocument()
    })

    it('should handle mixed status servers', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'typescript-language-server', status: 'connected', root: '/project' },
        { id: '2', name: 'python-lsp-server', status: 'error', root: '/project/src' },
        { id: '3', name: 'rust-analyzer', status: 'connected', root: '/project/core' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      const activeBadges = screen.getAllByText('Active')
      const errorBadges = screen.getAllByText('Error')

      expect(activeBadges).toHaveLength(2)
      expect(errorBadges).toHaveLength(1)
    })

    it('should truncate long server names', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'very-long-server-name-that-should-be-truncated', status: 'connected', root: '/project' }
      ]

      const { container } = render(<RepoLspServerList isLoading={false} data={mockData} />)

      const nameElement = container.querySelector('.truncate')
      expect(nameElement).toHaveClass('truncate')
    })

    it('should truncate long root paths', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'typescript-language-server', status: 'connected', root: '/very/long/path/that/should/be/truncated/in/the/ui' }
      ]

      const { container } = render(<RepoLspServerList isLoading={false} data={mockData} />)

      const pathElements = container.querySelectorAll('.truncate')
      expect(pathElements.length).toBeGreaterThan(0)
    })
  })

  describe('formatServerName utility', () => {
    it('should convert hyphen-separated names to spaced format', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'my-custom-language-server', status: 'connected', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('My custom language server')).toBeInTheDocument()
    })

    it('should convert underscore-separated names to spaced format', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'my_custom_language_server', status: 'connected', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('My custom language server')).toBeInTheDocument()
    })

    it('should handle mixed separators', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'my-custom_language-server', status: 'connected', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('My custom language server')).toBeInTheDocument()
    })

    it('should capitalize first letter', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'server', status: 'connected', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('Server')).toBeInTheDocument()
    })

    it('should handle single word names', () => {
      const mockData: LspStatus[] = [
        { id: '1', name: 'analyzer', status: 'connected', root: '/project' }
      ]

      render(<RepoLspServerList isLoading={false} data={mockData} />)

      expect(screen.getByText('Analyzer')).toBeInTheDocument()
    })
  })
})
