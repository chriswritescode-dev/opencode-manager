import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PromptSuggestions, type PromptSuggestion } from './PromptSuggestions'

const items: PromptSuggestion<string>[] = [
  { key: 'review', value: 'review', kind: 'command', label: '/review', ranges: [[1, 4]], detail: 'Review changes' },
  { key: 'redo', value: 'redo', kind: 'command', label: '/redo', ranges: [[1, 3]], tag: 'recent' },
]

const renderList = (props: Partial<Parameters<typeof PromptSuggestions<string>>[0]> = {}) => {
  const handlers = { onSelect: vi.fn(), onSwipeRight: vi.fn(), onClose: vi.fn() }
  render(<PromptSuggestions isOpen items={items} selectedIndex={0} takeover {...handlers} {...props} />)
  return handlers
}

const rowButton = (label: string) => screen.getAllByRole('button').find((button) => button.textContent?.startsWith(label))!

describe('PromptSuggestions', () => {
  it('places the best match nearest the composer in takeover mode', () => {
    renderList()

    const rows = screen.getAllByRole('button').map((button) => button.textContent)
    expect(rows[rows.length - 1]).toContain('/review')
  })

  it('keeps best-first order in the desktop popover', () => {
    renderList({ takeover: false })

    expect(screen.getAllByRole('button')[0]).toHaveTextContent('/review')
  })

  it('highlights matched characters', () => {
    renderList()

    expect(screen.getByText('rev')).toHaveClass('underline')
  })

  it('selects a row on tap', () => {
    const handlers = renderList()
    const row = rowButton('/redo')

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 10, clientY: 10 }] })

    expect(handlers.onSelect).toHaveBeenCalledWith('redo')
    expect(handlers.onSwipeRight).not.toHaveBeenCalled()
  })

  it('runs a row on a long enough right swipe', () => {
    const handlers = renderList()
    const row = rowButton('/review')

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.touchMove(row, { touches: [{ clientX: 130, clientY: 12 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 130, clientY: 12 }] })

    expect(handlers.onSwipeRight).toHaveBeenCalledWith('review')
    expect(handlers.onSelect).not.toHaveBeenCalled()
  })

  it('ignores a short swipe', () => {
    const handlers = renderList()
    const row = rowButton('/review')

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.touchMove(row, { touches: [{ clientX: 50, clientY: 10 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 50, clientY: 10 }] })

    expect(handlers.onSwipeRight).not.toHaveBeenCalled()
    expect(handlers.onSelect).not.toHaveBeenCalled()
  })

  it('omits the icon for commands but keeps it for other kinds', () => {
    renderList({
      items: [
        { key: 'review', value: 'review', kind: 'command', label: '/review', ranges: [] },
        { key: 'build', value: 'build', kind: 'agent', label: '@build', ranges: [] },
      ],
    })

    expect(rowButton('/review').querySelector('svg')).toBeNull()
    expect(rowButton('@build').querySelector('svg')).not.toBeNull()
  })

  it('renders nothing without items', () => {
    renderList({ items: [] })

    expect(screen.queryByTestId('prompt-suggestions')).not.toBeInTheDocument()
  })
})
