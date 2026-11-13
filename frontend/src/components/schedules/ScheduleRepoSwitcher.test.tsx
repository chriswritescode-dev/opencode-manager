import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { ScheduleRepoSwitcher } from './ScheduleRepoSwitcher'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { makeRepo } from '@/test/fixtures/api'
import { installWindowSize } from '@/test/browserFakes'
import type { Repo } from '@/api/types'

const repos: Repo[] = [
  makeRepo({ id: 1, name: 'repo1', localPath: 'repo1-path', fullPath: '/repos/repo1-path' }),
  makeRepo({ id: 2, name: 'repo2', localPath: 'repo2-path', fullPath: '/repos/repo2-path' }),
  makeRepo({ id: ASSISTANT_REPO_ID, name: 'Assistant', localPath: 'assistant', fullPath: '/repos/assistant' }),
]

function renderSwitcher(repoId: number | undefined, name: string, mobile = false) {
  installWindowSize(mobile ? 500 : 1024)
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  renderWithProviders(
    <>
      <ScheduleRepoSwitcher repoId={repoId} name={name} />
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
    </>,
    {
      route: '/repos/1/schedules',
      fetchRoutes: [{ method: 'GET', path: '/api/repos', respond: () => ({ json: repos }) }],
    },
  )
  return capturedPathname
}

describe('ScheduleRepoSwitcher', () => {
  it('shows the current repository and switches to another repo on desktop', async () => {
    const user = userEvent.setup()
    const pathname = renderSwitcher(1, 'repo1')

    await user.click(screen.getByRole('button', { name: 'Switch repository (repo1)' }))

    await waitFor(() => expect(screen.getByText('All repos')).toBeInTheDocument())
    expect(screen.getByText('repo2')).toBeInTheDocument()

    await user.click(screen.getByText('repo2'))

    await waitFor(() => expect(pathname.current).toBe('/repos/2/schedules'))
  })

  it('switches to all repos', async () => {
    const user = userEvent.setup()
    const pathname = renderSwitcher(1, 'repo1')

    await user.click(screen.getByRole('button', { name: 'Switch repository (repo1)' }))
    await waitFor(() => expect(screen.getByText('All repos')).toBeInTheDocument())

    await user.click(screen.getByText('All repos'))

    await waitFor(() => expect(pathname.current).toBe('/schedules'))
  })

  it('marks the current repository as active', async () => {
    const user = userEvent.setup()
    renderSwitcher(1, 'repo1')

    await user.click(screen.getByRole('button', { name: 'Switch repository (repo1)' }))
    const menu = await screen.findByRole('menu')

    expect(within(menu).getByText('repo1').closest('[aria-current="true"]')).not.toBeNull()
    expect(within(menu).getByText('repo2').closest('[aria-current="true"]')).toBeNull()
  })

  it('navigates to the assistant schedules for repo 0', async () => {
    const user = userEvent.setup()
    const pathname = renderSwitcher(ASSISTANT_REPO_ID, 'Assistant')

    await user.click(screen.getByRole('button', { name: 'Switch repository (Assistant)' }))
    await waitFor(() => expect(screen.getByText('repo2')).toBeInTheDocument())

    await user.click(screen.getByText('repo2'))

    await waitFor(() => expect(pathname.current).toBe('/repos/2/schedules'))
  })

  it('filters repositories by search on mobile', async () => {
    renderSwitcher(1, 'repo1', true)

    fireEvent.click(screen.getByRole('button', { name: 'Switch repository (repo1)' }))

    const search = await screen.findByPlaceholderText('Search repositories...')
    fireEvent.change(search, { target: { value: 'repo2' } })

    const sheet = screen.getByRole('dialog', { name: 'Switch repository' })
    await waitFor(() => {
      expect(within(sheet).getByText('repo2')).toBeInTheDocument()
      expect(within(sheet).queryByText('repo1')).not.toBeInTheDocument()
    })
  })

  it('switches repositories from the mobile sheet', async () => {
    const pathname = renderSwitcher(1, 'repo1', true)

    fireEvent.click(screen.getByRole('button', { name: 'Switch repository (repo1)' }))
    await screen.findByPlaceholderText('Search repositories...')
    await waitFor(() => expect(screen.getByText('repo2')).toBeInTheDocument())

    fireEvent.click(screen.getByText('repo2'))

    await waitFor(() => expect(pathname.current).toBe('/repos/2/schedules'))
  })
})
