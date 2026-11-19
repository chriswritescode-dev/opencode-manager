import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DEFAULT_DIRECT_SHORTCUTS, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_LEADER_KEY } from '@/api/types/settings'
import { renderWithProviders } from '@/test/render'
import { createSettingsServer } from '@/test/fixtures/settingsServer'
import type { UserPreferences } from '@/api/types/settings'
import type { FetchFake, FetchRoute } from '@/test/fetchFake'

const PREFERENCES: Partial<UserPreferences> = { keyboardShortcuts: { customAction: 'Alt+J' } }

async function renderShortcuts(
  ui: Parameters<typeof renderWithProviders>[0] = <KeyboardShortcuts />,
  preferences: Partial<UserPreferences> = PREFERENCES,
) {
  const settings = createSettingsServer(preferences)
  const routes: FetchRoute[] = [...settings.routes]
  const result = renderWithProviders(ui, { auth: false, theme: false, tts: false, fetchRoutes: routes })
  await screen.findByRole('heading', { name: 'Keyboard Shortcuts' })
  return result
}

function patchBody(fetchFake: FetchFake) {
  return fetchFake.lastRequest('PATCH', '/api/settings')?.body
}

async function waitForPatchCount(fetchFake: FetchFake, count: number) {
  await waitFor(() => expect(fetchFake.findRequests('PATCH', '/api/settings')).toHaveLength(count))
  return patchBody(fetchFake)
}

function makeFile(content: string, name: string) {
  const file = new File([content], name)
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) })
  return file
}

function getFileInput(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('file input not found')
  return input
}

function customActionRow() {
  const row = screen.getByText('custom Action').parentElement?.parentElement
  if (!(row instanceof HTMLElement)) throw new Error('row not found')
  return row
}

describe('KeyboardShortcuts layout', () => {
  it('groups every default and custom action exactly once', async () => {
    await renderShortcuts()

    expect(screen.getByRole('region', { name: 'Conversation actions' })).toBeInTheDocument()
    const navigation = screen.getByRole('region', { name: 'Navigation' })
    for (const action of [...Object.keys(DEFAULT_KEYBOARD_SHORTCUTS), 'customAction']) {
      expect(
        screen.getAllByText(action.replace(/([A-Z])/g, ' $1').trim(), { exact: true }),
      ).toHaveLength(1)
    }
    expect(within(navigation).getByText('custom Action')).toBeInTheDocument()
  })

  it('keeps recording focused through modifier updates and saves the selected action', async () => {
    const { fetchFake } = await renderShortcuts()

    fireEvent.click(screen.getByRole('button', { name: /Alt\+J/ }))
    const input = screen.getByPlaceholderText('Press keys...')
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Control', ctrlKey: true })
    expect(screen.getByPlaceholderText('Press keys...')).toBe(input)
    expect(input).toHaveFocus()

    fireEvent.keyDown(input, { key: 'k', ctrlKey: true })

    expect(await waitForPatchCount(fetchFake, 1)).toMatchObject({
      preferences: {
        keyboardShortcuts: { customAction: 'Ctrl+K' },
        directShortcuts: [...DEFAULT_DIRECT_SHORTCUTS, 'customAction'],
      },
    })
    expect(screen.queryByPlaceholderText('Press keys...')).not.toBeInTheDocument()
  })

  it('records the leader key followed by a key as a leader shortcut', async () => {
    const { fetchFake } = await renderShortcuts()

    fireEvent.click(screen.getByRole('button', { name: /Ctrl\+T/ }))
    const input = screen.getByPlaceholderText('Press keys...')

    fireEvent.keyDown(input, { key: 'x', ctrlKey: true })
    expect(patchBody(fetchFake)).toBeUndefined()
    expect(input).toHaveValue(`${DEFAULT_LEADER_KEY} → `)

    fireEvent.keyDown(input, { key: 'v' })

    expect(await waitForPatchCount(fetchFake, 1)).toMatchObject({
      preferences: {
        keyboardShortcuts: { variantCycle: 'V' },
        directShortcuts: DEFAULT_DIRECT_SHORTCUTS.filter((action) => action !== 'variantCycle'),
      },
    })
  })

  it('preserves direct-toggle and clear actions in a grouped row', async () => {
    const { fetchFake } = await renderShortcuts()
    const row = customActionRow()

    fireEvent.click(within(row).getByRole('button', { name: 'Requires leader key (click to make direct)' }))
    expect(await waitForPatchCount(fetchFake, 1)).toEqual({
      preferences: { directShortcuts: [...DEFAULT_DIRECT_SHORTCUTS, 'customAction'] },
    })

    fireEvent.click(within(row).getByTitle('Clear shortcut'))
    expect(await waitForPatchCount(fetchFake, 2)).toMatchObject({
      preferences: { keyboardShortcuts: { customAction: '' } },
    })
    expect(within(row).getByRole('button', { name: 'Not set' })).toBeInTheDocument()
  })

  it('cancels recording on Escape without saving a binding', async () => {
    const { fetchFake } = await renderShortcuts()

    fireEvent.click(screen.getByRole('button', { name: /Alt\+J/ }))
    const input = screen.getByPlaceholderText('Press keys...')

    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false)

    expect(screen.queryByPlaceholderText('Press keys...')).not.toBeInTheDocument()
    expect(patchBody(fetchFake)).toBeUndefined()
  })

  it('cancels recording a leader key on Escape without binding Escape as the leader', async () => {
    const { fetchFake } = await renderShortcuts()

    fireEvent.click(screen.getByRole('button', { name: DEFAULT_LEADER_KEY }))
    const input = screen.getByPlaceholderText('Press keys...')

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByPlaceholderText('Press keys...')).not.toBeInTheDocument()
    expect(patchBody(fetchFake)).toBeUndefined()
  })

  it('keeps an open Radix dialog open when Escape cancels recording', async () => {
    const onOpenChange = vi.fn()
    await renderShortcuts(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <KeyboardShortcuts />
        </DialogContent>
      </Dialog>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Alt\+J/ }))
    fireEvent.keyDown(screen.getByPlaceholderText('Press keys...'), { key: 'Escape' })

    expect(screen.queryByPlaceholderText('Press keys...')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('unbinds the action already using the recorded binding and names it in a toast', async () => {
    const { fetchFake } = await renderShortcuts()

    fireEvent.click(screen.getByRole('button', { name: /Alt\+J/ }))
    fireEvent.keyDown(screen.getByPlaceholderText('Press keys...'), { key: 't', ctrlKey: true })

    expect(await waitForPatchCount(fetchFake, 1)).toMatchObject({
      preferences: {
        keyboardShortcuts: { customAction: 'Ctrl+T', variantCycle: '' },
        directShortcuts: [...DEFAULT_DIRECT_SHORTCUTS, 'customAction'],
      },
    })
    expect(await screen.findByText('Shortcut conflict resolved')).toBeInTheDocument()
    expect(await screen.findByText('Unbound to avoid conflicts: variant cycle')).toBeInTheDocument()
  })

  it('resets custom shortcuts and the leader key to the defaults', async () => {
    const { fetchFake } = await renderShortcuts()

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))

    expect(await waitForPatchCount(fetchFake, 1)).toEqual({
      preferences: { keyboardShortcuts: {}, directShortcuts: [], leaderKey: '' },
    })
    expect(await screen.findByText('Keyboard shortcuts reset to defaults')).toBeInTheDocument()
  })
})

describe('KeyboardShortcuts TUI import', () => {
  it('parses the selected file and applies the imported shortcuts once', async () => {
    const { container, fetchFake } = await renderShortcuts()

    fireEvent.change(getFileInput(container), {
      target: { files: [makeFile('{"keybinds":{"leader":"ctrl+space","session.interrupt":"<leader>s"}}', 'cli.json')] },
    })

    expect(await screen.findByText('Imported 2 shortcuts from cli.json')).toBeInTheDocument()
    expect(await waitForPatchCount(fetchFake, 1)).toMatchObject({
      preferences: {
        keyboardShortcuts: { abort: 'S' },
        directShortcuts: DEFAULT_DIRECT_SHORTCUTS.filter((action) => action !== 'abort'),
        leaderKey: 'Ctrl+Space',
      },
    })
  })

  it('shows an error and leaves settings untouched when parsing fails', async () => {
    const { container, fetchFake } = await renderShortcuts()

    fireEvent.change(getFileInput(container), {
      target: { files: [makeFile('{"keybinds": 42}', 'cli.json')] },
    })

    expect(await screen.findByText('Could not import shortcuts')).toBeInTheDocument()
    expect(await screen.findByText('No keybinds found in this file')).toBeInTheDocument()
    expect(fetchFake.findRequests('PATCH', '/api/settings')).toHaveLength(0)
  })

  it('lists skipped entries in the success toast description', async () => {
    const keybinds = {
      keybinds: {
        'session.interrupt': 'hyper+x',
        'prompt.clear': 'hyper+x',
        'agent.cycle': 'hyper+x',
        'variant.cycle': 'hyper+x',
        'model.cycle_favorite': 'hyper+x',
        'session.undo': 'hyper+x',
        'session.new': 'alt+j',
      },
    }
    const { container } = await renderShortcuts(<KeyboardShortcuts />, {
      keyboardShortcuts: { customAction: 'Alt+J' },
      directShortcuts: [...DEFAULT_DIRECT_SHORTCUTS, 'customAction'],
    })

    fireEvent.change(getFileInput(container), {
      target: { files: [makeFile(JSON.stringify(keybinds), 'tui.json')] },
    })

    expect(await screen.findByText('Imported 1 shortcut from tui.json')).toBeInTheDocument()
    expect(
      await screen.findByText(
        'Unbound to avoid conflicts: custom action. Skipped: session.interrupt (unsupported modifier "hyper"), prompt.clear (unsupported modifier "hyper"), agent.cycle (unsupported modifier "hyper"), variant.cycle (unsupported modifier "hyper"), model.cycle_favorite (unsupported modifier "hyper") and 1 more',
      ),
    ).toBeInTheDocument()
  })
})
