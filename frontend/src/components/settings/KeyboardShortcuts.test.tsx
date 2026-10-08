import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { DEFAULT_DIRECT_SHORTCUTS, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_LEADER_KEY } from '@/api/types/settings'

const { updateSettings, parseTuiKeybindConfig, applyTuiKeybindImport, showToast } = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  parseTuiKeybindConfig: vi.fn(),
  applyTuiKeybindImport: vi.fn(),
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  },
}))

vi.mock('@/hooks/useMobile', () => ({ useMobile: () => false }))
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    preferences: { keyboardShortcuts: { customAction: 'Alt+J' } },
    isLoading: false,
    updateSettings,
  }),
}))
vi.mock('@/lib/tuiKeybindImport', () => ({ parseTuiKeybindConfig, applyTuiKeybindImport }))
vi.mock('@/lib/toast', () => ({ showToast }))

const getFileInput = (container: HTMLElement) => {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('file input not found')
  return input as HTMLInputElement
}

const makeFile = (content: string, name: string) => {
  const file = new File([content], name)
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) })
  return file
}

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
    expect(updateSettings).toHaveBeenCalledWith({
      keyboardShortcuts: expect.objectContaining({ customAction: 'Ctrl+K' }),
      directShortcuts: [...DEFAULT_DIRECT_SHORTCUTS, 'customAction'],
    })
    expect(screen.queryByPlaceholderText('Press keys...')).not.toBeInTheDocument()
  })

  it('records the leader key followed by a key as a leader shortcut', () => {
    render(<KeyboardShortcuts />)
    fireEvent.click(screen.getByRole('button', { name: /Ctrl\+T/ }))
    const input = screen.getByPlaceholderText('Press keys...')

    fireEvent.keyDown(input, { key: 'x', ctrlKey: true })
    expect(updateSettings).not.toHaveBeenCalled()
    expect(input).toHaveValue(`${DEFAULT_LEADER_KEY} → `)

    fireEvent.keyDown(input, { key: 'v' })
    expect(updateSettings).toHaveBeenCalledWith({
      keyboardShortcuts: expect.objectContaining({ variantCycle: 'V' }),
      directShortcuts: DEFAULT_DIRECT_SHORTCUTS.filter((action) => action !== 'variantCycle'),
    })
  })

  it('preserves direct-toggle and clear actions in a grouped row', () => {
    render(<KeyboardShortcuts />)
    const row = screen.getByText('custom Action').parentElement!.parentElement!
    fireEvent.click(within(row).getByRole('button', { name: 'Requires leader key (click to make direct)' }))
    expect(updateSettings).toHaveBeenCalledWith({ directShortcuts: [...DEFAULT_DIRECT_SHORTCUTS, 'customAction'] })
    fireEvent.click(within(row).getByTitle('Clear shortcut'))
    expect(updateSettings).toHaveBeenCalledWith({ keyboardShortcuts: expect.objectContaining({ customAction: '' }) })
    expect(within(row).getByRole('button', { name: 'Not set' })).toBeInTheDocument()
  })
})

describe('KeyboardShortcuts TUI import', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses the selected file and applies the imported shortcuts once', async () => {
    const imported = {
      leaderKey: 'Ctrl+Space',
      shortcuts: { submit: 'S' },
      leaderActions: [],
      directActions: [],
      skipped: [],
    }
    parseTuiKeybindConfig.mockReturnValue(imported)
    applyTuiKeybindImport.mockReturnValue({
      keyboardShortcuts: { submit: 'S' },
      directShortcuts: DEFAULT_DIRECT_SHORTCUTS,
      leaderKey: 'Ctrl+Space',
      cleared: [],
    })

    const { container } = render(<KeyboardShortcuts />)
    fireEvent.change(getFileInput(container), {
      target: { files: [makeFile('{"keybinds":{}}', 'cli.json')] },
    })

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1))
    expect(parseTuiKeybindConfig).toHaveBeenCalledWith('{"keybinds":{}}')
    expect(applyTuiKeybindImport).toHaveBeenCalledWith(imported, {
      keyboardShortcuts: expect.objectContaining({ customAction: 'Alt+J' }),
      directShortcuts: DEFAULT_DIRECT_SHORTCUTS,
    })
    expect(updateSettings).toHaveBeenCalledWith({
      keyboardShortcuts: { submit: 'S' },
      directShortcuts: DEFAULT_DIRECT_SHORTCUTS,
      leaderKey: 'Ctrl+Space',
    })
    expect(showToast.success).toHaveBeenCalledWith('Imported 2 shortcuts from cli.json', undefined)
  })

  it('shows an error and leaves settings untouched when parsing fails', async () => {
    parseTuiKeybindConfig.mockImplementation(() => {
      throw new Error('Invalid JSONC')
    })

    const { container } = render(<KeyboardShortcuts />)
    fireEvent.change(getFileInput(container), {
      target: { files: [makeFile('not jsonc', 'cli.json')] },
    })

    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('Could not import shortcuts', { description: 'Invalid JSONC' }),
    )
    expect(updateSettings).not.toHaveBeenCalled()
    expect(applyTuiKeybindImport).not.toHaveBeenCalled()
  })

  it('lists skipped entries in the success toast description', async () => {
    const skipped = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, reason: 'unsupported' }))
    parseTuiKeybindConfig.mockReturnValue({
      shortcuts: { submit: 'S' },
      leaderActions: [],
      directActions: [],
      skipped,
    })
    applyTuiKeybindImport.mockReturnValue({
      keyboardShortcuts: { submit: 'S' },
      directShortcuts: DEFAULT_DIRECT_SHORTCUTS,
      cleared: ['toggleMode'],
    })

    const { container } = render(<KeyboardShortcuts />)
    fireEvent.change(getFileInput(container), {
      target: { files: [makeFile('{}', 'tui.json')] },
    })

    await waitFor(() => expect(showToast.success).toHaveBeenCalled())
    expect(showToast.success).toHaveBeenCalledWith('Imported 1 shortcut from tui.json', {
      description:
        'Unbound to avoid conflicts: toggle mode. Skipped: a (unsupported), b (unsupported), c (unsupported), d (unsupported), e (unsupported) and 1 more',
    })
  })
})
