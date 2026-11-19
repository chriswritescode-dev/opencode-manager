import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMatchMedia } from '@/test/browserFakes'
import { renderWithProviders } from '@/test/render'
import { RowActionsMenuContext, SettingsList, SettingsListRow } from './settings-list'
import { DirectoryFilesList } from '@/components/settings/DirectoryFilesList'

describe('SettingsList', () => {
  it('renders emptyTitle and emptyHint when isEmpty and no children visible', () => {
    renderWithProviders(
      <SettingsList isEmpty emptyTitle="Nothing here" emptyHint="Try adding something">
        <div>child</div>
      </SettingsList>,
      { auth: false, theme: false },
    )
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('Try adding something')).toBeInTheDocument()
    expect(screen.queryByText('child')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing here').parentElement).toHaveClass('max-h-40')
  })

  it('renders loadingLabel when isLoading', () => {
    renderWithProviders(
      <SettingsList isEmpty={false} isLoading loadingLabel="Please wait...">
        <div>child</div>
      </SettingsList>,
      { auth: false, theme: false },
    )
    expect(screen.getByText('Please wait...')).toBeInTheDocument()
  })

  it('renders error.message when error passed', () => {
    renderWithProviders(
      <SettingsList isEmpty={false} error={new Error('Something broke')}>
        <div>child</div>
      </SettingsList>,
      { auth: false, theme: false },
    )
    expect(screen.getByText('Something broke')).toBeInTheDocument()
  })
})

describe('SettingsListRow', () => {
  it('renders title, description, and badges content', () => {
    renderWithProviders(
      <SettingsListRow
        title="Row Title"
        description="Row description"
        badges={<span data-testid="badge">Badge</span>}
      />,
      { auth: false, theme: false },
    )
    expect(screen.getByText('Row Title')).toBeInTheDocument()
    expect(screen.getByText('Row description')).toBeInTheDocument()
    expect(screen.getByTestId('badge')).toHaveTextContent('Badge')
  })

  it('calls primaryAction.onClick when primary action button is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderWithProviders(
      <SettingsListRow title="Row" primaryAction={{ label: 'Do It', onClick }} />,
      { auth: false, theme: false },
    )

    await user.click(screen.getByText('Do It'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('fires row onClick when row body is clicked and does not fire when action-column button is clicked', async () => {
    const user = userEvent.setup()
    const rowClick = vi.fn()
    const primaryClick = vi.fn()

    renderWithProviders(
      <SettingsListRow
        title="Row"
        onClick={rowClick}
        primaryAction={{ label: 'Action', onClick: primaryClick }}
      />,
      { auth: false, theme: false },
    )

    await user.click(screen.getByText('Row'))
    expect(rowClick).toHaveBeenCalledTimes(1)

    await user.click(screen.getByText('Action'))
    expect(primaryClick).toHaveBeenCalledTimes(1)
    expect(rowClick).toHaveBeenCalledTimes(1)
  })

  it('opens overflow menu and clicking action calls onClick; destructive item has text-destructive class', async () => {
    const user = userEvent.setup()
    const actionClick = vi.fn()

    renderWithProviders(
      <SettingsListRow
        title="Row"
        actionsLabel="More options"
        actions={[
          { label: 'Edit', onClick: vi.fn() },
          { label: 'Delete', onClick: actionClick, destructive: true },
        ]}
      />,
      { auth: false, theme: false },
    )

    await user.click(screen.getByLabelText('More options'))

    const deleteItem = screen.getByText('Delete')
    expect(deleteItem).toBeInTheDocument()
    expect(deleteItem.closest('div[class*="text-destructive"]')).toBeInTheDocument()

    await user.click(deleteItem)
    expect(actionClick).toHaveBeenCalledTimes(1)
  })

  function renderScopedRow(onPrimary: () => void, onDelete: () => void) {
    return renderWithProviders(
      <RowActionsMenuContext.Provider value={true}>
        <div data-opencode-settings>
          <SettingsListRow
            title="Row"
            primaryAction={{ label: 'Edit', onClick: onPrimary }}
            actionsLabel="More options"
            actions={[{ label: 'Delete', onClick: onDelete, destructive: true }]}
          />
        </div>
      </RowActionsMenuContext.Provider>,
      { auth: false, theme: false },
    )
  }

  it('keeps primary and overflow actions reachable inside the compact settings scope on desktop', async () => {
    const user = userEvent.setup()
    const primaryClick = vi.fn()
    const deleteClick = vi.fn()
    installMatchMedia(true)

    renderScopedRow(primaryClick, deleteClick)

    await user.click(screen.getByText('Edit'))
    expect(primaryClick).toHaveBeenCalledTimes(1)

    await user.click(screen.getByLabelText('More options'))
    await user.click(screen.getByText('Delete'))
    expect(deleteClick).toHaveBeenCalledTimes(1)
  })

  it('collapses the primary action into the overflow menu on mobile settings rows', async () => {
    const user = userEvent.setup()
    const primaryClick = vi.fn()
    const deleteClick = vi.fn()
    installMatchMedia(false)

    renderScopedRow(primaryClick, deleteClick)

    expect(screen.queryByText('Edit')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('More options'))
    await user.click(screen.getByText('Edit'))
    expect(primaryClick).toHaveBeenCalledTimes(1)

    await user.click(screen.getByLabelText('More options'))
    await user.click(screen.getByText('Delete'))
    expect(deleteClick).toHaveBeenCalledTimes(1)
  })
})

describe('DirectoryFilesList', () => {
  it('labels the raw file editor with the full file path', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <DirectoryFilesList
        kind="agents"
        files={[{ kind: 'agents', name: 'planner', relativePath: 'team/planner.md' }]}
      />,
      {
        auth: false,
        theme: false,
        fetchRoutes: [
          {
            method: 'GET',
            path: '/api/settings/opencode-directory-files/content',
            respond: () => ({
              json: { kind: 'agents', name: 'planner', relativePath: 'team/planner.md', content: '# file' },
            }),
          },
        ],
      },
    )

    await user.click(screen.getByText('planner'))
    expect(await screen.findByRole('textbox', { name: 'team/planner.md' })).toBeInTheDocument()
  })
})
