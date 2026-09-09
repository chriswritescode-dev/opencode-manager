import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { DEFAULT_KEYBOARD_SHORTCUTS } from '@/api/types/settings'

const { updateSettings } = vi.hoisted(() => ({ updateSettings: vi.fn() }))

vi.mock('@/hooks/useMobile', () => ({ useMobile: () => false }))
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    preferences: { keyboardShortcuts: { customAction: 'Alt+J' } },
    isLoading: false,
    updateSettings,
  }),
}))

describe('KeyboardShortcuts layout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('groups every default and custom action exactly once', () => {
    render(<KeyboardShortcuts />)
    expect(screen.getByRole('region', { name: 'Conversation actions' })).toBeInTheDocument()
    const navigation = screen.getByRole('region', { name: 'Navigation' })
    for (const action of [...Object.keys(DEFAULT_KEYBOARD_SHORTCUTS), 'customAction']) {
      expect(screen.getAllByText(action.replace(/([A-Z])/g, ' $1').trim(), { exact: true })).toHaveLength(1)
    }
    expect(within(navigation).getByText('custom Action')).toBeInTheDocument()
  })

  it('keeps recording focused through modifier updates and saves the selected action', () => {
    render(<KeyboardShortcuts />)
    fireEvent.click(screen.getByRole('button', { name: /Alt\+J/ }))
    const input = screen.getByPlaceholderText('Press keys...')
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Control', ctrlKey: true })
    expect(screen.getByPlaceholderText('Press keys...')).toBe(input)
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'k', ctrlKey: true })
    expect(updateSettings).toHaveBeenCalledWith({ keyboardShortcuts: expect.objectContaining({ customAction: 'Ctrl+K' }) })
    expect(screen.queryByPlaceholderText('Press keys...')).not.toBeInTheDocument()
  })

  it('preserves direct-toggle and clear actions in a grouped row', () => {
    render(<KeyboardShortcuts />)
    const row = screen.getByText('custom Action').parentElement!.parentElement!
    fireEvent.click(within(row).getByRole('button', { name: 'Requires leader key (click to make direct)' }))
    expect(updateSettings).toHaveBeenCalledWith({ directShortcuts: ['submit', 'abort', 'customAction'] })
    fireEvent.click(within(row).getByTitle('Clear shortcut'))
    expect(updateSettings).toHaveBeenCalledWith({ keyboardShortcuts: expect.objectContaining({ customAction: '' }) })
    expect(within(row).getByRole('button', { name: 'Not set' })).toBeInTheDocument()
  })
})
