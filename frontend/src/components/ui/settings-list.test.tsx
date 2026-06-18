import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SettingsList, SettingsListRow } from './settings-list'

describe('SettingsList', () => {
  it('renders emptyTitle and emptyHint when isEmpty and no children visible', () => {
    render(
      <SettingsList isEmpty emptyTitle="Nothing here" emptyHint="Try adding something">
        <div>child</div>
      </SettingsList>,
    )
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('Try adding something')).toBeInTheDocument()
    expect(screen.queryByText('child')).not.toBeInTheDocument()
  })

  it('renders loadingLabel when isLoading', () => {
    render(
      <SettingsList isEmpty={false} isLoading loadingLabel="Please wait...">
        <div>child</div>
      </SettingsList>,
    )
    expect(screen.getByText('Please wait...')).toBeInTheDocument()
  })

  it('renders error.message when error passed', () => {
    render(
      <SettingsList isEmpty={false} error={new Error('Something broke')}>
        <div>child</div>
      </SettingsList>,
    )
    expect(screen.getByText('Something broke')).toBeInTheDocument()
  })
})

describe('SettingsListRow', () => {
  it('renders title, description, and badges content', () => {
    render(
      <SettingsListRow
        title="Row Title"
        description="Row description"
        badges={<span data-testid="badge">Badge</span>}
      />,
    )
    expect(screen.getByText('Row Title')).toBeInTheDocument()
    expect(screen.getByText('Row description')).toBeInTheDocument()
    expect(screen.getByTestId('badge')).toHaveTextContent('Badge')
  })

  it('calls primaryAction.onClick when primary action button is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<SettingsListRow title="Row" primaryAction={{ label: 'Do It', onClick }} />)

    await user.click(screen.getByText('Do It'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('fires row onClick when row body is clicked and does not fire when action-column button is clicked', async () => {
    const user = userEvent.setup()
    const rowClick = vi.fn()
    const primaryClick = vi.fn()

    render(
      <SettingsListRow
        title="Row"
        onClick={rowClick}
        primaryAction={{ label: 'Action', onClick: primaryClick }}
      />,
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

    render(
      <SettingsListRow
        title="Row"
        actionsLabel="More options"
        actions={[
          { label: 'Edit', onClick: vi.fn() },
          { label: 'Delete', onClick: actionClick, destructive: true },
        ]}
      />,
    )

    await user.click(screen.getByLabelText('More options'))

    const deleteItem = screen.getByText('Delete')
    expect(deleteItem).toBeInTheDocument()
    expect(deleteItem.closest('div[class*="text-destructive"]')).toBeInTheDocument()

    await user.click(deleteItem)
    expect(actionClick).toHaveBeenCalledTimes(1)
  })
})
