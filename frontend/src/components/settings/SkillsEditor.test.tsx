import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SkillFileInfo } from '@opencode-manager/shared'
import { SkillsEditor } from './SkillsEditor'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'

const githubUrl = 'https://github.com/mattpocock/skills/tree/main/skills/productivity/teach'

const mockSkill: SkillFileInfo = {
  name: 'test-skill',
  description: 'A test skill',
  body: '# Test Skill\nSome content',
  location: '/home/user/.config/opencode/skills/test-skill/SKILL.md',
  scope: 'global',
}

const installedSkill: SkillFileInfo = {
  name: 'teach',
  description: 'Teach a skill',
  body: '# Teach',
  location: '/home/user/.config/opencode/skills/teach/SKILL.md',
  scope: 'global',
}

function installResponse(installed: string[]) {
  return {
    skill: installedSkill,
    overwritten: false,
    sourceType: 'github',
    filesInstalled: installed,
  }
}

type InstallReply = () => FetchRouteResult | Promise<FetchRouteResult>

function renderEditor(managedSkills: SkillFileInfo[] = [], installReplies: InstallReply[] = []) {
  let installAttempt = 0
  const fetchRoutes: FetchRoute[] = [
    { method: 'GET', path: '/api/repos', respond: () => ({ json: [] }) },
    {
      method: 'POST',
      path: '/api/settings/skills/install',
      respond: () => {
        const reply = installReplies[installAttempt]
        installAttempt += 1
        return reply ? reply() : { json: installResponse(['SKILL.md']) }
      },
    },
    {
      method: 'DELETE',
      path: '/api/settings/skills/:name',
      respond: () => ({ json: { success: true } }),
    },
  ]
  return renderWithProviders(<SkillsEditor managedSkills={managedSkills} />, {
    auth: false,
    theme: false,
    tts: false,
    fetchRoutes,
  })
}

describe('SkillsEditor', () => {
  it('shows install skill button beside create skill', () => {
    renderEditor()

    expect(screen.getByRole('button', { name: 'Install Skill' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Skill' })).toBeInTheDocument()
  })

  it('installs from GitHub URL', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Install Skill' }))
    await user.type(screen.getByPlaceholderText('Paste a GitHub skill URL'), githubUrl)
    await user.click(screen.getByRole('button', { name: /^Install$/ }))

    expect(fetchFake.lastRequest('POST', '/api/settings/skills/install')?.body).toEqual({
      sourceType: 'github',
      url: githubUrl,
      scope: 'global',
    })
    expect(await screen.findByText('Skill installed successfully')).toBeInTheDocument()
  })

  it('uploads a single SKILL.md', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Install Skill' }))
    await user.click(screen.getByRole('tab', { name: 'Upload' }))

    await waitFor(() => expect(document.querySelectorAll('input[type="file"]')).toHaveLength(2))
    const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
    const file = new File(['# Test Skill'], 'SKILL.md', { type: 'text/markdown' })
    await user.upload(fileInputs[0], file)
    await user.click(screen.getByRole('button', { name: /^Install$/ }))

    const formData = fetchFake.findFormData()
    expect(formData?.get('sourceType')).toBe('upload')
    expect(formData?.get('scope')).toBe('global')
    expect(formData?.get('file0')).toBeInstanceOf(File)
    expect(formData?.get('fileManifest')).toBe(JSON.stringify([{ fieldName: 'file0', relativePath: 'SKILL.md' }]))
  })

  it('prompts overwrite after a 409 conflict', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderEditor([], [
      () => ({ status: 409, json: { error: 'Skill "teach" already exists in global scope' } }),
      () => ({ json: { ...installResponse(['SKILL.md']), overwritten: true } }),
    ])

    await user.click(screen.getByRole('button', { name: 'Install Skill' }))
    await user.type(screen.getByPlaceholderText('Paste a GitHub skill URL'), githubUrl)
    await user.click(screen.getByRole('button', { name: /^Install$/ }))

    expect(
      await screen.findByText(
        'A skill with this name already exists. Install again to overwrite the managed skill directory.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Overwrite and install' }))

    expect(fetchFake.findRequests('POST', '/api/settings/skills/install')).toHaveLength(2)
    expect(fetchFake.lastRequest('POST', '/api/settings/skills/install')?.body).toEqual({
      sourceType: 'github',
      url: githubUrl,
      scope: 'global',
      overwrite: true,
    })
  })

  it('mentions bundled files in the delete dialog and deletes the skill', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderEditor([mockSkill])

    await user.click(screen.getByLabelText('Actions for test-skill'))
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(await screen.findByText(/bundled files/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Delete$/ }))

    expect(
      fetchFake.lastRequest('DELETE', '/api/settings/skills/test-skill')?.searchParams.get('scope'),
    ).toBe('global')
  })
})
