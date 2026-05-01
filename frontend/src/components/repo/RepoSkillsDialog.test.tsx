import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { RepoSkillsDialog } from './RepoSkillsDialog'
import type { SkillFileInfo } from '@opencode-manager/shared'

const mocks = vi.hoisted(() => ({
  listManagedSkills: vi.fn(),
  sendCommand: vi.fn(),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    listManagedSkills: mocks.listManagedSkills,
  },
}))

vi.mock('@/api/opencode', () => ({
  OpenCodeClient: vi.fn(() => ({
    sendCommand: mocks.sendCommand,
  })),
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('RepoSkillsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  const mockSkills: SkillFileInfo[] = [
    {
      name: 'test-skill',
      description: 'A test skill for testing',
      body: 'Test skill content',
      location: '/repo/.opencode/skills/test-skill/SKILL.md',
      scope: 'project',
    },
    {
      name: 'global-skill',
      description: 'A global skill',
      body: 'Global skill content',
      location: '/home/user/.config/opencode/skills/global-skill/SKILL.md',
      scope: 'global',
    },
  ]

  describe('tabs and skill filtering', () => {
    it('shows both tabs when skills exist', async () => {
      mocks.listManagedSkills.mockResolvedValue(mockSkills)

      render(
        <RepoSkillsDialog
          open
          onOpenChange={vi.fn()}
          repoId={1}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByText('Project')).toBeInTheDocument()
      expect(screen.getByText('Global')).toBeInTheDocument()
    })

    it('shows project skills in project tab', async () => {
      mocks.listManagedSkills.mockResolvedValue(mockSkills)

      render(
        <RepoSkillsDialog
          open
          onOpenChange={vi.fn()}
          repoId={1}
        />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Test skill')).toBeInTheDocument()
      })
    })

    it('shows global skills in global tab', async () => {
      mocks.listManagedSkills.mockResolvedValue(mockSkills)

      render(
        <RepoSkillsDialog
          open
          onOpenChange={vi.fn()}
          repoId={1}
        />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Project')).toBeInTheDocument()
      })

      const globalTab = screen.getByText('Global')
      await userEvent.click(globalTab)

      expect(screen.getByText('Global skill')).toBeInTheDocument()
    })

    it('shows empty state for project tab when no project skills', async () => {
      mocks.listManagedSkills.mockResolvedValue([
        {
          name: 'global-skill',
          description: 'A global skill',
          body: 'Global skill content',
          location: '/home/user/.config/opencode/skills/global-skill/SKILL.md',
          scope: 'global',
        },
      ])

      render(
        <RepoSkillsDialog
          open
          onOpenChange={vi.fn()}
          repoId={1}
        />,
        { wrapper: createWrapper() }
      )

      const projectTab = screen.getByText('Project')
      await userEvent.click(projectTab)

      await waitFor(() => {
        expect(screen.getByText('No local skills found')).toBeInTheDocument()
      })
    })
  })

  describe('load functionality', () => {
    it('shows Load button when sessionId and opcodeUrl are provided', async () => {
      mocks.listManagedSkills.mockResolvedValue(mockSkills)
      mocks.sendCommand.mockResolvedValue(undefined)

      const onSkillLoaded = vi.fn()
      const onOpenChange = vi.fn()

      render(
        <RepoSkillsDialog
          open
          onOpenChange={onOpenChange}
          repoId={1}
          sessionId="test-session"
          opcodeUrl="http://localhost:5551"
          directory="/test/repo"
          onSkillLoaded={onSkillLoaded}
        />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Test skill')).toBeInTheDocument()
      })

      expect(screen.getByText('Load')).toBeInTheDocument()
    })

    it('does not show Load button when sessionId is not provided', async () => {
      mocks.listManagedSkills.mockResolvedValue(mockSkills)

      render(
        <RepoSkillsDialog
          open
          onOpenChange={vi.fn()}
          repoId={1}
        />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Test skill')).toBeInTheDocument()
      })

      expect(screen.queryByText('Load')).not.toBeInTheDocument()
    })

    it('calls sendCommand and closes dialog on Load click', async () => {
      mocks.listManagedSkills.mockResolvedValue(mockSkills)
      mocks.sendCommand.mockReturnValue(new Promise(() => {}))

      const onSkillLoaded = vi.fn()
      const onOpenChange = vi.fn()
      const user = userEvent.setup()

      render(
        <RepoSkillsDialog
          open
          onOpenChange={onOpenChange}
          repoId={1}
          sessionId="test-session"
          opcodeUrl="http://localhost:5551"
          directory="/test/repo"
          onSkillLoaded={onSkillLoaded}
        />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Test skill')).toBeInTheDocument()
      })

      const loadButton = screen.getByText('Load')
      await user.click(loadButton)

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onSkillLoaded).toHaveBeenCalledWith(mockSkills[0])
      expect(mocks.sendCommand).toHaveBeenCalledWith('test-session', {
        command: 'test-skill',
        arguments: '',
      })
    })

    it('shows toast error on sendCommand failure', async () => {
      const { showToast } = await import('@/lib/toast')
      mocks.listManagedSkills.mockResolvedValue(mockSkills)
      mocks.sendCommand.mockRejectedValue(new Error('Failed to load'))

      const onOpenChange = vi.fn()
      const user = userEvent.setup()

      render(
        <RepoSkillsDialog
          open
          onOpenChange={onOpenChange}
          repoId={1}
          sessionId="test-session"
          opcodeUrl="http://localhost:5551"
          directory="/test/repo"
        />,
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(screen.getByText('Test skill')).toBeInTheDocument()
      })

      const loadButton = screen.getByText('Load')
      await user.click(loadButton)

      await waitFor(() => {
        expect(showToast.error).toHaveBeenCalledWith('Failed to load')
      })

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
