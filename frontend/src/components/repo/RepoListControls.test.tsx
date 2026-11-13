import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoListControls } from './RepoListControls'
import { installPointerCapture, installWindowSize } from '@/test/browserFakes'
import type { RepoFilterMode, RepoSortMode } from './repo-list-state'

function baseProps(overrides: {
  filterMode?: RepoFilterMode
  sortMode?: RepoSortMode
  selectionMode?: boolean
  selectedCount?: number
} = {}) {
  return {
    searchQuery: '',
    onSearchChange: vi.fn(),
    filterMode: overrides.filterMode ?? 'recent',
    onFilterModeChange: vi.fn(),
    sortMode: overrides.sortMode ?? 'recent',
    onSortModeChange: vi.fn(),
    filteredCount: 3,
    attentionCount: 0,
    selectedCount: overrides.selectedCount ?? 0,
    allVisibleSelected: false,
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onDelete: vi.fn(),
    hasLocalRepos: false,
    hasClonedRepos: false,
    selectionMode: overrides.selectionMode ?? false,
    onSelectionModeChange: vi.fn(),
    onAddRepo: vi.fn(),
  }
}

describe('RepoListControls', () => {
  beforeEach(() => {
    installPointerCapture()
  })

  it('renders the add repository button after the search input on mobile', () => {
    installWindowSize(480)

    render(<RepoListControls {...baseProps()} />)

    const search = screen.getByRole('textbox')
    const addButton = screen.getByRole('button', { name: 'Add repository' })

    expect(search.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('calls onAddRepo once when the mobile button is clicked', async () => {
    installWindowSize(480)
    const props = baseProps()
    const user = userEvent.setup()

    render(<RepoListControls {...props} />)
    await user.click(screen.getByRole('button', { name: 'Add repository' }))

    expect(props.onAddRepo).toHaveBeenCalledTimes(1)
  })

  it('does not render the add repository button on desktop', () => {
    render(<RepoListControls {...baseProps()} />)

    expect(screen.queryByRole('button', { name: 'Add repository' })).not.toBeInTheDocument()
  })

  it('offers the sort options in the mobile filter menu', async () => {
    installWindowSize(480)
    const props = baseProps()
    const user = userEvent.setup()

    render(<RepoListControls {...props} />)
    await user.click(screen.getByRole('button', { name: 'Filter and sort repositories' }))

    expect(await screen.findByText('Sort by')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Name' }))

    expect(props.onSortModeChange).toHaveBeenCalledWith('name')
  })

  it('shows the active non-default filter on mobile and clears it back to the default', async () => {
    installWindowSize(480)
    const props = baseProps({ filterMode: 'attention' })
    const user = userEvent.setup()

    render(<RepoListControls {...props} />)

    const chip = screen.getByRole('button', { name: 'Clear filter: Changes' })
    expect(chip).toHaveTextContent('Changes')

    await user.click(chip)

    expect(props.onFilterModeChange).toHaveBeenCalledWith('recent')
  })

  it('hides the active filter chip for the default filter', () => {
    installWindowSize(480)

    render(<RepoListControls {...baseProps()} />)

    expect(screen.queryByRole('button', { name: /Clear filter/ })).not.toBeInTheDocument()
  })

  it('shows the selection toolbar as soon as select mode is on', () => {
    installWindowSize(480)

    render(<RepoListControls {...baseProps({ selectionMode: true })} />)

    expect(screen.getByText('0 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done selecting repositories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('exits select mode from the Done button', async () => {
    installWindowSize(480)
    const props = baseProps({ selectionMode: true, selectedCount: 2 })
    const user = userEvent.setup()

    render(<RepoListControls {...props} />)
    await user.click(screen.getByRole('button', { name: 'Done selecting repositories' }))

    expect(props.onClearSelection).toHaveBeenCalledTimes(1)
  })
})
