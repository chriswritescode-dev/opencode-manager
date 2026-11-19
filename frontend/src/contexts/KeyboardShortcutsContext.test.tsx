import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import {
  DEFAULT_DIRECT_SHORTCUTS,
  DEFAULT_KEYBOARD_SHORTCUTS,
  type UserPreferences,
} from '@/api/types/settings'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'
import { renderWithProviders } from '@/test/render'
import { KeyboardShortcutsProvider } from './KeyboardShortcutsContext'
import { useShortcutActions, type ShortcutActions } from './keyboard-shortcuts-context'

function pressKey(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function mountElement<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}) {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  return document.body.appendChild(element)
}

function ActionLayer({ actions, scope = 'page' }: { actions: ShortcutActions; scope?: 'global' | 'page' }) {
  useShortcutActions(actions, scope)
  return null
}

function ConditionalLayer({ show, actions }: { show: boolean; actions: ShortcutActions }) {
  if (!show) return null
  return <ActionLayer actions={actions} />
}

let setPageLayerVisible: (visible: boolean) => void = () => undefined

function HideableLayer({ actions }: { actions: ShortcutActions }) {
  const [visible, setVisible] = useState(true)
  setPageLayerVisible = setVisible
  return <ConditionalLayer show={visible} actions={actions} />
}

function withShortcuts(
  keyboardShortcuts: Partial<typeof DEFAULT_KEYBOARD_SHORTCUTS> = {},
  directShortcuts: string[] = [...DEFAULT_DIRECT_SHORTCUTS],
): UserPreferences {
  return makeUserPreferences({
    keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS, ...keyboardShortcuts },
    directShortcuts,
  })
}

async function renderProvider(children: ReactNode, preferences: UserPreferences = withShortcuts()) {
  const result = renderWithProviders(<KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>, {
    auth: false,
    theme: false,
    toaster: false,
    fetchRoutes: [
      { method: 'GET', path: '/api/settings', respond: () => ({ json: makeSettingsResponse({ preferences }) }) },
    ],
  })
  await waitFor(() => expect(result.queryClient.getQueryData(['settings', 'default'])).toBeDefined())
  return result
}

describe('KeyboardShortcutsProvider', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('matches stored Enter and Escape bindings against Return and Esc key events', async () => {
    const submit = vi.fn()
    const abort = vi.fn()
    await renderProvider(<ActionLayer actions={{ submit, abort }} />, withShortcuts({ submit: 'Ctrl+Enter' }))
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })

    pressKey(prompt, { key: 'Enter', ctrlKey: true })
    pressKey(document.body, { key: 'Escape' })

    expect(submit).toHaveBeenCalledTimes(1)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('activates the leader from the prompt and runs the follow-up action without typing it', async () => {
    const newSession = vi.fn()
    await renderProvider(<ActionLayer actions={{ newSession }} />)
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })

    expect(pressKey(prompt, { key: 'x', ctrlKey: true }).defaultPrevented).toBe(true)
    const followUp = pressKey(prompt, { key: 'n' })

    expect(newSession).toHaveBeenCalledTimes(1)
    expect(followUp.defaultPrevented).toBe(true)
  })

  it('applies new default direct actions for users with stored preferences that predate them', async () => {
    const variantCycle = vi.fn()
    await renderProvider(
      <ActionLayer actions={{ variantCycle }} />,
      makeUserPreferences({
        keyboardShortcuts: { submit: 'Ctrl+Enter', abort: 'Escape', newSession: 'N' },
        directShortcuts: ['submit', 'abort'],
      }),
    )
    const input = mountElement('textarea')

    pressKey(input, { key: 't', ctrlKey: true })

    expect(variantCycle).toHaveBeenCalledTimes(1)
  })

  it('leaves submit to the focused input and only interrupts from the prompt', async () => {
    const submit = vi.fn()
    const abort = vi.fn()
    await renderProvider(<ActionLayer actions={{ submit, abort }} />)
    const otherInput = mountElement('input')
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })

    pressKey(otherInput, { key: 'Enter', ctrlKey: true })
    pressKey(otherInput, { key: 'Escape' })
    expect(submit).not.toHaveBeenCalled()
    expect(abort).not.toHaveBeenCalled()

    pressKey(prompt, { key: 'Escape' })
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('submits from the prompt on plain Enter when submit is bound to Enter, leaving Enter alone elsewhere', async () => {
    const submit = vi.fn()
    await renderProvider(<ActionLayer actions={{ submit }} />, withShortcuts({ submit: 'Return' }))
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })
    const button = mountElement('button')

    expect(pressKey(prompt, { key: 'Enter' }).defaultPrevented).toBe(true)
    expect(submit).toHaveBeenCalledTimes(1)

    expect(pressKey(prompt, { key: 'Enter', shiftKey: true }).defaultPrevented).toBe(false)
    expect(pressKey(prompt, { key: 'Enter', isComposing: true }).defaultPrevented).toBe(false)
    expect(pressKey(button, { key: 'Enter' }).defaultPrevented).toBe(false)
    expect(pressKey(document.body, { key: 'Enter' }).defaultPrevented).toBe(false)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('cycles the agent with a direct Tab only from the prompt, keeping Tab for focus elsewhere', async () => {
    const toggleMode = vi.fn()
    await renderProvider(<ActionLayer actions={{ toggleMode }} />, withShortcuts({ toggleMode: 'Tab' }))
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })
    const button = mountElement('button')
    const otherInput = mountElement('input')

    expect(pressKey(button, { key: 'Tab' }).defaultPrevented).toBe(false)
    expect(pressKey(document.body, { key: 'Tab' }).defaultPrevented).toBe(false)
    expect(pressKey(otherInput, { key: 'Tab' }).defaultPrevented).toBe(false)
    expect(toggleMode).not.toHaveBeenCalled()

    expect(pressKey(prompt, { key: 'Tab' }).defaultPrevented).toBe(true)
    expect(toggleMode).toHaveBeenCalledTimes(1)
  })

  it('never runs a prompt-only shortcut on a key that types a character', async () => {
    const toggleMode = vi.fn()
    await renderProvider(<ActionLayer actions={{ toggleMode }} />, withShortcuts({ toggleMode: 'T' }))
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })

    expect(pressKey(prompt, { key: 't' }).defaultPrevented).toBe(false)
    expect(toggleMode).not.toHaveBeenCalled()
  })

  it('clears the prompt with a direct Ctrl+C only from the prompt', async () => {
    const clearPrompt = vi.fn()
    await renderProvider(<ActionLayer actions={{ clearPrompt }} />, withShortcuts({ clearPrompt: 'Ctrl+C' }))
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })
    const otherInput = mountElement('textarea')
    const button = mountElement('button')

    expect(pressKey(otherInput, { key: 'c', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(pressKey(button, { key: 'c', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(pressKey(document.body, { key: 'c', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(clearPrompt).not.toHaveBeenCalled()

    expect(pressKey(prompt, { key: 'c', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(clearPrompt).toHaveBeenCalledTimes(1)
  })

  it('runs a direct half-page-down shortcut with Ctrl+D from the body and the prompt', async () => {
    const halfPageDown = vi.fn()
    await renderProvider(<ActionLayer actions={{ halfPageDown }} />)
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })

    expect(pressKey(document.body, { key: 'd', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(halfPageDown).toHaveBeenCalledTimes(1)

    expect(pressKey(prompt, { key: 'd', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(halfPageDown).toHaveBeenCalledTimes(2)
  })

  it('runs a direct half-page-up shortcut with Ctrl+U from the body and the prompt, never from another text field', async () => {
    const halfPageUp = vi.fn()
    await renderProvider(<ActionLayer actions={{ halfPageUp }} />)
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })
    const otherInput = mountElement('input')

    expect(pressKey(otherInput, { key: 'u', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(halfPageUp).not.toHaveBeenCalled()

    expect(pressKey(document.body, { key: 'u', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(pressKey(prompt, { key: 'u', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(halfPageUp).toHaveBeenCalledTimes(2)
  })

  it('does not abort while a dialog overlay is open, leaving Escape to the overlay', async () => {
    const abort = vi.fn()
    await renderProvider(<ActionLayer actions={{ abort }} />)
    mountElement('div', { role: 'dialog', 'data-state': 'open' })

    expect(pressKey(document.body, { key: 'Escape' }).defaultPrevented).toBe(false)
    expect(abort).not.toHaveBeenCalled()
  })

  it('aborts with Escape when no dialog overlay is open', async () => {
    const abort = vi.fn()
    await renderProvider(<ActionLayer actions={{ abort }} />)
    mountElement('div', { role: 'dialog', 'data-state': 'closed' })

    expect(pressKey(document.body, { key: 'Escape' }).defaultPrevented).toBe(true)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('runs leader and direct shortcuts from a terminal before it consumes the keys, passing other keys through', async () => {
    const newSession = vi.fn()
    const toggleTerminal = vi.fn()
    await renderProvider(<ActionLayer actions={{ newSession, toggleTerminal }} />)
    const terminal = mountElement('div', { 'data-terminal-id': 'pty-1' })
    const terminalInput = terminal.appendChild(document.createElement('textarea'))
    const shellInput = vi.fn()
    terminalInput.addEventListener('keydown', (event) => {
      shellInput(event.key)
      event.preventDefault()
    })

    pressKey(terminalInput, { key: 'x', ctrlKey: true })
    pressKey(terminalInput, { key: 'n' })
    pressKey(terminalInput, { key: 'x', ctrlKey: true })
    pressKey(terminalInput, { key: 't' })
    pressKey(terminalInput, { key: 'l' })

    expect(newSession).toHaveBeenCalledTimes(1)
    expect(toggleTerminal).toHaveBeenCalledTimes(1)
    expect(shellInput.mock.calls).toEqual([['l']])
  })

  it('passes direct shortcuts through in a terminal while keeping the leader and toggleTerminal', async () => {
    const variantCycle = vi.fn()
    const halfPageUp = vi.fn()
    const toggleTerminal = vi.fn()
    await renderProvider(<ActionLayer actions={{ variantCycle, halfPageUp, toggleTerminal }} />)
    const terminal = mountElement('div', { 'data-terminal-id': 'pty-2' })
    const terminalInput = terminal.appendChild(document.createElement('textarea'))

    expect(pressKey(terminalInput, { key: 't', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(pressKey(terminalInput, { key: 'u', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(variantCycle).not.toHaveBeenCalled()
    expect(halfPageUp).not.toHaveBeenCalled()

    pressKey(terminalInput, { key: 'x', ctrlKey: true })
    expect(pressKey(terminalInput, { key: 't' }).defaultPrevented).toBe(true)
    expect(toggleTerminal).toHaveBeenCalledTimes(1)
  })

  it('ignores key events a component already handled', async () => {
    const abort = vi.fn()
    await renderProvider(<ActionLayer actions={{ abort }} />)
    const element = mountElement('div')
    element.addEventListener('keydown', (event) => event.preventDefault())

    pressKey(element, { key: 'Escape' })

    expect(abort).not.toHaveBeenCalled()
  })

  it('does not swallow a key whose action has no handler', async () => {
    await renderProvider(<ActionLayer actions={{ abort: undefined }} />)

    expect(pressKey(document.body, { key: 'Escape' }).defaultPrevented).toBe(false)
  })

  it('prefers a page layer over a global layer for the same action', async () => {
    const globalAbort = vi.fn()
    const pageAbort = vi.fn()
    await renderProvider(
      <>
        <ActionLayer actions={{ abort: globalAbort }} scope="global" />
        <ActionLayer actions={{ abort: pageAbort }} scope="page" />
      </>,
    )

    pressKey(document.body, { key: 'Escape' })

    expect(pageAbort).toHaveBeenCalledTimes(1)
    expect(globalAbort).not.toHaveBeenCalled()
  })

  it('falls through to the global handler when a page layer leaves the action undefined', async () => {
    const globalAbort = vi.fn()
    await renderProvider(
      <>
        <ActionLayer actions={{ abort: globalAbort }} scope="global" />
        <ActionLayer actions={{ abort: undefined }} scope="page" />
      </>,
    )

    pressKey(document.body, { key: 'Escape' })

    expect(globalAbort).toHaveBeenCalledTimes(1)
  })

  it('restores the global handler when a page layer unmounts', async () => {
    const globalAbort = vi.fn()
    const pageAbort = vi.fn()
    await renderProvider(
      <>
        <ActionLayer actions={{ abort: globalAbort }} scope="global" />
        <HideableLayer actions={{ abort: pageAbort }} />
      </>,
    )

    pressKey(document.body, { key: 'Escape' })
    expect(pageAbort).toHaveBeenCalledTimes(1)
    expect(globalAbort).not.toHaveBeenCalled()

    act(() => {
      setPageLayerVisible(false)
    })

    pressKey(document.body, { key: 'Escape' })
    expect(globalAbort).toHaveBeenCalledTimes(1)
  })

  it('shows the leader indicator after the leader key and hides it after the follow-up key', async () => {
    const newSession = vi.fn()
    await renderProvider(<ActionLayer actions={{ newSession }} />)

    pressKey(document.body, { key: 'x', ctrlKey: true })
    expect(screen.getByText('Waiting for shortcut key...')).toBeInTheDocument()

    pressKey(document.body, { key: 'n' })
    await waitFor(() => expect(screen.queryByText('Waiting for shortcut key...')).not.toBeInTheDocument())
    expect(newSession).toHaveBeenCalledTimes(1)
  })

  it('throws when used outside the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useShortcutActions({ abort: vi.fn() }))).toThrow(
      'useShortcutActions must be used within a KeyboardShortcutsProvider',
    )
    consoleError.mockRestore()
  })
})
