import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installPointerCapture } from '@/test/browserFakes'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import type { RepoGitIdentity } from '@opencode-manager/shared'
import { RepoGitIdentitySelect } from './RepoGitIdentitySelect'

const preset = { id: 'a', name: 'Alpha', email: 'alpha@example.com' }

const identityPatchSchema = z.object({ identityId: z.string().nullable() })

const repositoryPreset: RepoGitIdentity = { name: 'Alpha', email: 'alpha@example.com', scope: 'repository', presetId: 'a' }
const customIdentity: RepoGitIdentity = { name: 'Custom', email: 'custom@example.com', scope: 'repository', presetId: null }

function identityForSelection(identityId: string | null): RepoGitIdentity {
  if (identityId === 'a') return repositoryPreset
  return { name: null, email: null, scope: 'none', presetId: null }
}

function renderSelect(identity: RepoGitIdentity) {
  const routes: FetchRoute[] = [
    { method: 'GET', path: '/api/repos/7/git-identity', respond: () => ({ json: identity }) },
    {
      method: 'PATCH',
      path: '/api/repos/7/git-identity',
      respond: (request) => {
        const patch = identityPatchSchema.safeParse(request.body)
        return { json: identityForSelection(patch.success ? patch.data.identityId : null) }
      },
    },
    {
      method: 'GET',
      path: '/api/settings',
      respond: () => ({
        json: makeSettingsResponse({ preferences: makeUserPreferences({ gitIdentities: [preset] }) }),
      }),
    },
  ]

  return renderWithProviders(<RepoGitIdentitySelect repoId={7} />, {
    auth: false,
    theme: false,
    fetchRoutes: routes,
  })
}

async function openSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('combobox', { name: 'Commit identity' }))
}

describe('RepoGitIdentitySelect', () => {
  beforeEach(() => {
    installPointerCapture()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    {
      label: 'the Manager default identity',
      identity: { name: 'Ada', email: 'ada@example.com', scope: 'default', presetId: null },
      expected: 'Default — Ada <ada@example.com> (Manager default)',
    },
    {
      label: 'the git global config identity',
      identity: { name: 'Ada', email: 'ada@example.com', scope: 'global', presetId: null },
      expected: 'Default — Ada <ada@example.com> (git global config)',
    },
    {
      label: 'the not-configured fallback',
      identity: { name: null, email: null, scope: 'none', presetId: null },
      expected: 'Default — not configured',
    },
  ])('shows $label as the effective default', async ({ identity, expected }) => {
    renderSelect(identity)

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Commit identity' })).toHaveTextContent(expected),
    )
  })

  it('selects the matching preset for a repository identity', async () => {
    renderSelect(repositoryPreset)

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Commit identity' })).toHaveTextContent('Alpha <alpha@example.com>'),
    )
  })

  it('shows a custom repository identity and confirms before replacing it', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { fetchFake } = renderSelect(customIdentity)

    await openSelect(user)
    const customOption = screen.getByRole('option', { name: 'Custom (Custom <custom@example.com>)' })
    expect(customOption).toHaveAttribute('data-disabled')

    await user.click(screen.getByRole('option', { name: 'Alpha <alpha@example.com>' }))
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Custom <custom@example.com>'))
    expect(fetchFake.findRequests('PATCH', '/api/repos/7/git-identity')).toHaveLength(0)

    confirmSpy.mockReturnValue(true)
    await openSelect(user)
    await user.click(screen.getByRole('option', { name: 'Alpha <alpha@example.com>' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/repos/7/git-identity')?.body).toEqual({ identityId: 'a' }),
    )
  })

  it('sends null when choosing Default and the preset id when choosing a preset', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderSelect(repositoryPreset)

    await openSelect(user)
    await user.click(screen.getByRole('option', { name: 'Default' }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/repos/7/git-identity')?.body).toEqual({ identityId: null }),
    )

    await openSelect(user)
    await user.click(screen.getByRole('option', { name: 'Alpha <alpha@example.com>' }))
    await waitFor(() =>
      expect(fetchFake.lastRequest('PATCH', '/api/repos/7/git-identity')?.body).toEqual({ identityId: 'a' }),
    )
  })
})
