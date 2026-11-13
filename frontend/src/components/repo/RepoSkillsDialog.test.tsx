import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoSkillsDialog } from './RepoSkillsDialog'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import type { SkillFileInfo } from '@opencode-manager/shared'

const localSkills = [
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
] satisfies SkillFileInfo[]

const remoteSkill = {
  id: 'sk_1',
  name: 'remote-skill',
  description: 'From the server',
  path: '/home/me/app/.opencode/skills/remote-skill/SKILL.md',
  content: 'Remote body',
}

function localRoutes(skills: SkillFileInfo[]): FetchRoute[] {
  return [{ method: 'GET', path: '/api/settings/skills', respond: () => ({ json: skills }) }]
}

function renderDialog(options: {
  skills?: SkillFileInfo[]
  sessionId?: string
  onSkillLoaded?: (skill: SkillFileInfo) => void
  onOpenChange?: (open: boolean) => void
  extraRoutes?: FetchRoute[]
}) {
  return renderWithProviders(
    <RepoSkillsDialog
      open
      onOpenChange={options.onOpenChange ?? vi.fn()}
      repoId={1}
      sessionId={options.sessionId}
      directory={options.sessionId ? '/test/repo' : undefined}
      onSkillLoaded={options.onSkillLoaded}
    />,
    {
      auth: false,
      theme: false,
      fetchRoutes: [...localRoutes(options.skills ?? localSkills), ...(options.extraRoutes ?? [])],
    },
  )
}

describe('RepoSkillsDialog', () => {
  describe('tabs and skill filtering', () => {
    it('shows both tabs when skills exist', async () => {
      renderDialog({})

      expect(await screen.findByRole('button', { name: /^Project/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Global/ })).toBeInTheDocument()
    })

    it('shows project skills in project tab', async () => {
      const user = userEvent.setup()
      renderDialog({})

      await user.click(await screen.findByRole('button', { name: /^Project/ }))

      expect(within(screen.getByText('test-skill').closest('li') ?? document.body).getByText('test-skill')).toBeInTheDocument()
      expect(screen.queryByText('global-skill')).not.toBeInTheDocument()
    })

    it('shows global skills in global tab', async () => {
      const user = userEvent.setup()
      renderDialog({})

      await user.click(await screen.findByRole('button', { name: /^Global/ }))

      expect(screen.getByText('global-skill')).toBeInTheDocument()
      expect(screen.queryByText('test-skill')).not.toBeInTheDocument()
    })

    it('shows empty state for project tab when no project skills', async () => {
      const user = userEvent.setup()
      renderDialog({ skills: [localSkills[1]] })

      await user.click(await screen.findByRole('button', { name: /^Project/ }))

      await waitFor(() => expect(screen.getByText('No skills found')).toBeInTheDocument())
    })
  })

  describe('load functionality', () => {
    it('offers a load action for skill rows when sessionId is provided', async () => {
      renderDialog({ sessionId: 'test-session' })

      expect(await screen.findByText('test-skill')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Load' })).toHaveLength(2)
    })

    it('hides the load action when sessionId is not provided', async () => {
      renderDialog({})

      await screen.findByText('test-skill')

      expect(screen.queryByRole('button', { name: 'Load' })).not.toBeInTheDocument()
    })

    it('activates the skill and closes the dialog on card click', async () => {
      const user = userEvent.setup()
      const onSkillLoaded = vi.fn()
      const onOpenChange = vi.fn()
      const { fetchFake } = renderDialog({
        sessionId: 'test-session',
        onSkillLoaded,
        onOpenChange,
        extraRoutes: [
          { method: 'POST', path: '/api/opencode/api/experimental/session/test-session/skill', respond: () => ({ status: 204 }) },
        ],
      })

      await user.click(await screen.findByText('test-skill'))

      await waitFor(() =>
        expect(fetchFake.lastRequest('POST', '/api/opencode/api/experimental/session/test-session/skill')?.body).toEqual({
          id: 'test-skill',
        }),
      )
      expect(onSkillLoaded).toHaveBeenCalledWith(localSkills[0])
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('shows a toast error when activating the skill fails', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      renderDialog({
        sessionId: 'test-session',
        onOpenChange,
        extraRoutes: [
          {
            method: 'POST',
            path: '/api/opencode/api/experimental/session/test-session/skill',
            respond: () => ({ status: 500, json: { error: 'Failed to load' } }),
          },
        ],
      })

      await user.click(await screen.findByText('test-skill'))

      expect(await screen.findByText('UnexpectedStatus: 500')).toBeInTheDocument()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe('linked server', () => {
    function renderRemote(options: {
      onSkillLoaded?: (skill: SkillFileInfo) => void
      onOpenChange?: (open: boolean) => void
      extraRoutes?: FetchRoute[]
    } = {}) {
      return renderWithProviders(
        <RepoSkillsDialog
          open
          onOpenChange={options.onOpenChange ?? vi.fn()}
          repoId={0}
          sessionId="ses_remote"
          directory="/home/me/app"
          onSkillLoaded={options.onSkillLoaded}
        />,
        {
          auth: false,
          theme: false,
          serverId: 'srv_kitchen',
          fetchRoutes: [
            { method: 'GET', path: '/api/opencode/servers/srv_kitchen/api/skill', respond: () => ({ json: { location: { directory: '/home/me/app' }, data: [remoteSkill] } }) },
            ...(options.extraRoutes ?? []),
          ],
        },
      )
    }

    it('lists skills from the linked server and hides install and delete actions', async () => {
      const { fetchFake } = renderRemote()

      expect(await screen.findByText('remote-skill')).toBeInTheDocument()
      expect(fetchFake.lastRequest('GET', '/api/opencode/servers/srv_kitchen/api/skill')?.searchParams.get('location[directory]')).toBe('/home/me/app')
      expect(fetchFake.findRequests('GET', '/api/settings/skills')).toHaveLength(0)
      expect(screen.queryByRole('button', { name: /install skill/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Actions for remote-skill' })).not.toBeInTheDocument()
    })

    it('loads a linked-server skill into the current session', async () => {
      const user = userEvent.setup()
      const onSkillLoaded = vi.fn()
      const onOpenChange = vi.fn()
      const { fetchFake } = renderRemote({
        onSkillLoaded,
        onOpenChange,
        extraRoutes: [
          {
            method: 'POST',
            path: '/api/opencode/servers/srv_kitchen/api/experimental/session/ses_remote/skill',
            respond: () => ({ status: 204 }),
          },
        ],
      })

      await user.click(await screen.findByText('remote-skill'))

      await waitFor(() =>
        expect(fetchFake.lastRequest('POST', '/api/opencode/servers/srv_kitchen/api/experimental/session/ses_remote/skill')?.body).toEqual({
          id: 'remote-skill',
        }),
      )
      expect(onSkillLoaded).toHaveBeenCalledWith({
        name: 'remote-skill',
        description: 'From the server',
        body: 'Remote body',
        scope: 'project',
        location: '/home/me/app/.opencode/skills/remote-skill/SKILL.md',
      })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
