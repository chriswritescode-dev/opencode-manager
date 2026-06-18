import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FetchError } from '@opencode-manager/shared'
import type { ReactNode } from 'react'
import { SkillsEditor } from './SkillsEditor'
import type { SkillFileInfo } from '@opencode-manager/shared'

const mocks = vi.hoisted(() => ({
  installSkillFromGithub: vi.fn(),
  installSkillFromUpload: vi.fn(),
  deleteSkill: vi.fn().mockResolvedValue({ success: true }),
  listManagedSkills: vi.fn(),
  listRepos: vi.fn().mockResolvedValue([]),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    installSkillFromGithub: mocks.installSkillFromGithub,
    installSkillFromUpload: mocks.installSkillFromUpload,
    deleteSkill: mocks.deleteSkill,
    listManagedSkills: mocks.listManagedSkills,
  },
}))

vi.mock('@/api/repos', () => ({
  listRepos: mocks.listRepos,
}))

vi.mock('sonner', () => ({
  toast: mocks.toast,
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockSkill: SkillFileInfo = {
  name: 'test-skill',
  description: 'A test skill',
  body: '# Test Skill\nSome content',
  location: '/home/user/.config/opencode/skills/test-skill/SKILL.md',
  scope: 'global',
}

describe('SkillsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows install skill button beside create skill', () => {
    render(<SkillsEditor managedSkills={[]} />, { wrapper: createWrapper() })

    expect(screen.getByText('Install Skill')).toBeInTheDocument()
    expect(screen.getByText('Create Skill')).toBeInTheDocument()
  })

  it('installs from GitHub URL', async () => {
    mocks.installSkillFromGithub.mockResolvedValue({
      skill: { name: 'teach', scope: 'global' },
      overwritten: false,
      sourceType: 'github',
      filesInstalled: ['SKILL.md'],
    })

    const user = userEvent.setup()
    render(<SkillsEditor managedSkills={[]} />, { wrapper: createWrapper() })

    await user.click(screen.getByText('Install Skill'))

    const urlInput = screen.getByPlaceholderText('Paste a GitHub skill URL')
    await user.type(urlInput, 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach')

    await user.click(screen.getByText('Install'))

    await waitFor(() => {
      expect(mocks.installSkillFromGithub).toHaveBeenCalledWith({
        sourceType: 'github',
        url: 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach',
        scope: 'global',
      })
    })
  })

  it('uploads a single SKILL.md', async () => {
    mocks.installSkillFromUpload.mockResolvedValue({
      skill: { name: 'teach', scope: 'global' },
      overwritten: false,
      sourceType: 'upload',
      filesInstalled: ['SKILL.md'],
    })

    const user = userEvent.setup()
    render(<SkillsEditor managedSkills={[]} />, { wrapper: createWrapper() })

    await user.click(screen.getByText('Install Skill'))

    const uploadTab = screen.getByText('Upload')
    await user.click(uploadTab)

    const file = new File(['# Test Skill'], 'SKILL.md', { type: 'text/markdown' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, file)

    await user.click(screen.getByText('Install'))

    await waitFor(() => {
      expect(mocks.installSkillFromUpload).toHaveBeenCalledWith({
        files: expect.arrayContaining([expect.any(File)]),
        scope: 'global',
      })
    })
  })

  it('prompts overwrite after 409 conflict', async () => {
    mocks.installSkillFromGithub
      .mockRejectedValueOnce(
        new FetchError('Skill "teach" already exists in global scope', 409)
      )
      .mockResolvedValueOnce({
        skill: { name: 'teach', scope: 'global' },
        overwritten: true,
        sourceType: 'github',
        filesInstalled: ['SKILL.md'],
      })

    const user = userEvent.setup()
    render(<SkillsEditor managedSkills={[]} />, { wrapper: createWrapper() })

    await user.click(screen.getByText('Install Skill'))

    const urlInput = screen.getByPlaceholderText('Paste a GitHub skill URL')
    await user.type(urlInput, 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach')

    await user.click(screen.getByText('Install'))

    await waitFor(() => {
      expect(
        screen.getByText(
          'A skill with this name already exists. Install again to overwrite the managed skill directory.'
        )
      ).toBeInTheDocument()
    })

    await user.click(screen.getByText('Overwrite and install'))

    await waitFor(() => {
      expect(mocks.installSkillFromGithub).toHaveBeenCalledTimes(2)
      expect(mocks.installSkillFromGithub).toHaveBeenLastCalledWith({
        sourceType: 'github',
        url: 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach',
        scope: 'global',
        overwrite: true,
      })
    })
  })

  it('delete dialog mentions bundled files', async () => {
    const user = userEvent.setup()
    render(<SkillsEditor managedSkills={[mockSkill]} />, {
      wrapper: createWrapper(),
    })

    await user.click(screen.getByLabelText('Actions for test-skill'))
    await user.click(screen.getByText('Delete'))

    await waitFor(() => {
      expect(screen.getByText(/bundled files/)).toBeInTheDocument()
    })
  })
})
