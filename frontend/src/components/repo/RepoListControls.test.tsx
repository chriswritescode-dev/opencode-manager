import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoListControls } from './RepoListControls'

const mocks = vi.hoisted(() => ({ mobile: { current: false } }))

vi.mock('@/hooks/useMobile', () => ({
  isMobileViewport: () => mocks.mobile.current,
  useMobile: () => mocks.mobile.current,
}))

function baseProps() {
  return {
    searchQuery: '',
    onSearchChange: vi.fn(),
    filterMode: 'recent' as const,
    onFilterModeChange: vi.fn(),
    sortMode: 'recent' as const,
    onSortModeChange: vi.fn(),
    filteredCount: 3,
    attentionCount: 0,
    selectedCount: 0,
    allVisibleSelected: false,
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onDelete: vi.fn(),
    hasLocalRepos: false,
    hasClonedRepos: false,
    selectionMode: false,
    onSelectionModeChange: vi.fn(),
    onAddRepo: vi.fn(),
  }
}

describe('RepoListControls', () => {
  beforeEach(() => {
    mocks.mobile.current = false
  })

  it('renders the add repository button after the search input on mobile', () => {
    mocks.mobile.current = true

    render(<RepoListControls {...baseProps()} />)

    const search = screen.getByRole('textbox')
    const addButton = screen.getByRole('button', { name: 'Add repository' })

    expect(
      search.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('calls onAddRepo once when the mobile button is clicked', async () => {
    mocks.mobile.current = true
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
    mocks.mobile.current = true
    const props = baseProps()
    const user = userEvent.setup()

    render(<RepoListControls {...props} />)
    await user.click(screen.getByRole('button', { name: 'Filter and sort repositories' }))

    expect(await screen.findByText('Sort by')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Name' }))

    expect(props.onSortModeChange).toHaveBeenCalledWith('name')
  })

  it('shows the active non-default filter on mobile and clears it back to the default', async () => {
    mocks.mobile.current = true
    const props = { ...baseProps(), filterMode: 'attention' as const }
    const user = userEvent.setup()

    render(<RepoListControls {...props} />)

    const chip = screen.getByRole('button', { name: 'Clear filter: Changes' })
    expect(chip).toHaveTextContent('Changes')

    await user.click(chip)

    expect(props.onFilterModeChange).toHaveBeenCalledWith('recent')
  })

  it('hides the active filter chip for the default filter', () => {
    mocks.mobile.current = true

    render(<RepoListControls {...baseProps()} />)

    expect(screen.queryByRole('button', { name: /Clear filter/ })).not.toBeInTheDocument()
  })

  it('shows the selection toolbar as soon as select mode is on', () => {
    mocks.mobile.current = true

    render(<RepoListControls {...baseProps()} selectionMode selectedCount={0} />)

    expect(screen.getByText('0 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done selecting repositories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('exits select mode from the Done button', async () => {
    mocks.mobile.current = true
    const props = { ...baseProps(), selectionMode: true, selectedCount: 2 }
    const user = userEvent.setup()

    render(<RepoListControls {...props} />)
    await user.click(screen.getByRole('button', { name: 'Done selecting repositories' }))

    expect(props.onClearSelection).toHaveBeenCalledTimes(1)
  })
})
