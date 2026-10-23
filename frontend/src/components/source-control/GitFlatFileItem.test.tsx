import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GitFileStatus } from '@/types/git'
import { GitFlatFileItem } from './GitFlatFileItem'

const defaultViewportWidth = window.innerWidth

function buildFile(overrides: Partial<GitFileStatus> = {}): GitFileStatus {
  return { path: 'notes.txt', status: 'modified', staged: false, ...overrides }
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

describe('GitFlatFileItem', () => {
  afterEach(() => {
    setViewportWidth(defaultViewportWidth)
  })

  it('renders an untracked directory once with its trailing slash', () => {
    render(
      <GitFlatFileItem
        file={buildFile({ path: '.ocm/', status: 'untracked' })}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByText('.ocm/')).toBeInTheDocument()
    expect(screen.queryByText('.ocm')).toBeNull()
  })

  it('keeps the parent directory of a nested untracked directory', () => {
    render(
      <GitFlatFileItem
        file={buildFile({ path: 'src/.ocm/', status: 'untracked' })}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={vi.fn()}
      />,
    )

    expect(screen.getByText('.ocm/')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  it('names the stage and discard actions after the file', async () => {
    const user = userEvent.setup()
    const onStage = vi.fn()
    const onDiscard = vi.fn()
    render(
      <GitFlatFileItem
        file={buildFile({ path: 'src/notes.txt' })}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={onStage}
        onDiscard={onDiscard}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Stage notes.txt' }))
    await user.click(screen.getByRole('button', { name: 'Discard changes to notes.txt' }))

    expect(onStage).toHaveBeenCalledWith('src/notes.txt')
    expect(onDiscard).toHaveBeenCalledWith('src/notes.txt', false)
  })

  it('names the unstage action for staged files', () => {
    render(
      <GitFlatFileItem
        file={buildFile({ path: 'notes.txt', staged: true })}
        isSelected={false}
        onSelect={vi.fn()}
        onUnstage={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Unstage notes.txt' })).toBeInTheDocument()
  })

  it('reveals the row actions without hovering on touch-sized viewports', () => {
    setViewportWidth(500)
    render(
      <GitFlatFileItem
        file={buildFile()}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Stage notes.txt' })).toHaveClass('opacity-100')
  })

  it('reveals hover-only actions when they receive focus', () => {
    setViewportWidth(1280)
    render(
      <GitFlatFileItem
        file={buildFile()}
        isSelected={false}
        onSelect={vi.fn()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
      />,
    )

    const stageButton = screen.getByRole('button', { name: 'Stage notes.txt' })
    expect(stageButton).toHaveClass('opacity-0')
    expect(stageButton).toHaveClass('focus-visible:opacity-100')
    expect(stageButton).toHaveClass('group-focus-within:opacity-100')
  })
})
