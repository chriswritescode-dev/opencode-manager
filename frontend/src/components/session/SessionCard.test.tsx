import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionCard } from './SessionCard'
import type { Session } from '@/api/types'

const session = {
  id: 'ses_1',
  title: 'test session',
  location: { directory: '/w/a' },
  time: { created: 1, updated: Date.now() },
} as unknown as Session

const renderCard = (props: Partial<Parameters<typeof SessionCard>[0]> = {}) => {
  const onSelect = vi.fn()
  const onToggleSelection = vi.fn()
  const onDelete = vi.fn()
  const result = render(
    <SessionCard
      session={session}
      isSelected={false}
      manageMode={false}
      onSelect={onSelect}
      onToggleSelection={onToggleSelection}
      onDelete={onDelete}
      {...props}
    />,
  )
  return { ...result, onSelect, onToggleSelection, onDelete }
}

const openSwipeReveal = () => {
  const row = document.querySelector('[data-row-swipe]') as HTMLElement
  const swipeSurface = row.lastElementChild as HTMLElement
  fireEvent.touchStart(swipeSurface, { touches: [{ clientX: 200, clientY: 10 }] })
  fireEvent.touchMove(swipeSurface, { touches: [{ clientX: 20, clientY: 12 }] })
  fireEvent.touchEnd(swipeSurface, { changedTouches: [{ clientX: 20, clientY: 12 }] })
  return swipeSurface
}

describe('SessionCard', () => {
  it('marks the row wrapper so panel swipe gestures yield to row gestures', () => {
    const { container } = renderCard({ onTogglePin: vi.fn(), onRename: vi.fn() })

    expect(container.querySelector('[data-row-swipe]')).toBeTruthy()
  })

  it('reveals pin, rename and delete actions after a swipe', () => {
    renderCard({ onTogglePin: vi.fn(), onRename: vi.fn() })

    const swipeSurface = openSwipeReveal()

    expect(swipeSurface.style.transform).toBe('translateX(-132px)')
    expect(screen.getByRole('button', { name: 'Pin session' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename session' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete session' })).toBeTruthy()
  })

  it('calls the pin handler from the swipe reveal', async () => {
    const user = userEvent.setup()
    const onTogglePin = vi.fn()
    renderCard({ onTogglePin, onRename: vi.fn() })

    openSwipeReveal()
    await user.click(screen.getByRole('button', { name: 'Pin session' }))

    expect(onTogglePin).toHaveBeenCalledTimes(1)
  })

  it('labels the pin action as unpin for pinned sessions', () => {
    renderCard({ onTogglePin: vi.fn(), onRename: vi.fn(), isPinned: true })

    expect(screen.getByRole('button', { name: 'Unpin session' })).toBeTruthy()
  })

  it('calls the rename handler from the swipe reveal', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    renderCard({ onTogglePin: vi.fn(), onRename })

    openSwipeReveal()
    await user.click(screen.getByRole('button', { name: 'Rename session' }))

    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('calls the delete handler from the swipe reveal', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderCard({ onTogglePin: vi.fn() })

    openSwipeReveal()
    await user.click(screen.getByRole('button', { name: 'Delete session' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('omits the rename action when no rename handler is supplied', () => {
    renderCard({ onTogglePin: vi.fn() })

    expect(screen.queryByRole('button', { name: 'Rename session' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete session' })).toBeTruthy()
  })

  it('renders the desktop actions menu and dispatches every action', async () => {
    const user = userEvent.setup()
    const onTogglePin = vi.fn()
    const onRename = vi.fn()
    const { onDelete } = renderCard({ onTogglePin, onRename })

    await user.click(screen.getByRole('button', { name: 'Session actions' }))
    expect(screen.getByRole('menuitem', { name: 'Pin to top' })).toBeTruthy()
    await user.click(screen.getByRole('menuitem', { name: 'Pin to top' }))
    expect(onTogglePin).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Session actions' }))
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onRename).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Session actions' }))
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
