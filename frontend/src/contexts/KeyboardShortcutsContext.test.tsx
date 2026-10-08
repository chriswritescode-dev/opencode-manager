import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { KeyboardShortcutsProvider, useShortcutActions, type ShortcutActions } from './KeyboardShortcutsContext'

const { preferences } = vi.hoisted(() => ({
  preferences: {
    leaderKey: 'Ctrl+O',
    keyboardShortcuts: { submit: 'Ctrl+Enter', abort: 'Escape', newSession: 'N' } as Record<string, string>,
    directShortcuts: ['submit', 'abort'],
  },
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ preferences }),
}))

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

function renderProvider(children: ReactNode) {
  return render(<KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>)
}

describe('KeyboardShortcutsProvider', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('matches stored Enter and Escape bindings against Return and Esc key events', () => {
    const submit = vi.fn()
    const abort = vi.fn()
    renderProvider(<ActionLayer actions={{ submit, abort }} />)
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })

    pressKey(prompt, { key: 'Enter', ctrlKey: true })
    pressKey(document.body, { key: 'Escape' })

    expect(submit).toHaveBeenCalledTimes(1)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('activates the leader from the prompt and runs the follow-up action without typing it', () => {
    const newSession = vi.fn()
    renderProvider(<ActionLayer actions={{ newSession }} />)
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })

    expect(pressKey(prompt, { key: 'o', ctrlKey: true }).defaultPrevented).toBe(true)
    const followUp = pressKey(prompt, { key: 'n' })

    expect(newSession).toHaveBeenCalledTimes(1)
    expect(followUp.defaultPrevented).toBe(true)
  })

  it('applies new default actions as direct shortcuts for users with legacy stored preferences', () => {
    const toggleTerminal = vi.fn()
    renderProvider(<ActionLayer actions={{ toggleTerminal }} />)
    const input = mountElement('textarea')

    pressKey(input, { key: '`', ctrlKey: true })

    expect(toggleTerminal).toHaveBeenCalledTimes(1)
  })

  it('leaves submit to the focused input and only interrupts from the prompt', () => {
    const submit = vi.fn()
    const abort = vi.fn()
    renderProvider(<ActionLayer actions={{ submit, abort }} />)
    const otherInput = mountElement('input')
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })

    pressKey(otherInput, { key: 'Enter', ctrlKey: true })
    pressKey(otherInput, { key: 'Escape' })
    expect(submit).not.toHaveBeenCalled()
    expect(abort).not.toHaveBeenCalled()

    pressKey(prompt, { key: 'Escape' })
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('submits from the prompt on plain Enter when submit is bound to Enter, leaving Enter alone elsewhere', () => {
    const original = preferences.keyboardShortcuts
    preferences.keyboardShortcuts = { ...original, submit: 'Return' }
    try {
      const submit = vi.fn()
      renderProvider(<ActionLayer actions={{ submit }} />)
      const prompt = mountElement('textarea', { 'data-prompt-input': '' })
      const button = mountElement('button')

      expect(pressKey(prompt, { key: 'Enter' }).defaultPrevented).toBe(true)
      expect(submit).toHaveBeenCalledTimes(1)

      expect(pressKey(prompt, { key: 'Enter', shiftKey: true }).defaultPrevented).toBe(false)
      expect(pressKey(prompt, { key: 'Enter', isComposing: true }).defaultPrevented).toBe(false)
      expect(pressKey(button, { key: 'Enter' }).defaultPrevented).toBe(false)
      expect(pressKey(document.body, { key: 'Enter' }).defaultPrevented).toBe(false)
      expect(submit).toHaveBeenCalledTimes(1)
    } finally {
      preferences.keyboardShortcuts = original
    }
  })

  it('cycles the agent with a direct Tab only from the prompt, keeping Tab for focus elsewhere', () => {
    const original = { keyboardShortcuts: preferences.keyboardShortcuts, directShortcuts: preferences.directShortcuts }
    preferences.keyboardShortcuts = { ...original.keyboardShortcuts, toggleMode: 'Tab' }
    preferences.directShortcuts = ['submit', 'abort', 'toggleMode']
    try {
      const toggleMode = vi.fn()
      renderProvider(<ActionLayer actions={{ toggleMode }} />)
      const prompt = mountElement('textarea', { 'data-prompt-input': '' })
      const button = mountElement('button')
      const otherInput = mountElement('input')

      expect(pressKey(button, { key: 'Tab' }).defaultPrevented).toBe(false)
      expect(pressKey(document.body, { key: 'Tab' }).defaultPrevented).toBe(false)
      expect(pressKey(otherInput, { key: 'Tab' }).defaultPrevented).toBe(false)
      expect(toggleMode).not.toHaveBeenCalled()

      expect(pressKey(prompt, { key: 'Tab' }).defaultPrevented).toBe(true)
      expect(toggleMode).toHaveBeenCalledTimes(1)
    } finally {
      preferences.keyboardShortcuts = original.keyboardShortcuts
      preferences.directShortcuts = original.directShortcuts
    }
  })

  it('never runs a prompt-only shortcut on a key that types a character', () => {
    const original = { keyboardShortcuts: preferences.keyboardShortcuts, directShortcuts: preferences.directShortcuts }
    preferences.keyboardShortcuts = { ...original.keyboardShortcuts, toggleMode: 'T' }
    preferences.directShortcuts = ['submit', 'abort', 'toggleMode']
    try {
      const toggleMode = vi.fn()
      renderProvider(<ActionLayer actions={{ toggleMode }} />)
      const prompt = mountElement('textarea', { 'data-prompt-input': '' })

      expect(pressKey(prompt, { key: 't' }).defaultPrevented).toBe(false)
      expect(toggleMode).not.toHaveBeenCalled()
    } finally {
      preferences.keyboardShortcuts = original.keyboardShortcuts
      preferences.directShortcuts = original.directShortcuts
    }
  })

  it('clears the prompt with a direct Ctrl+C only from the prompt', () => {
    const original = { keyboardShortcuts: preferences.keyboardShortcuts, directShortcuts: preferences.directShortcuts }
    preferences.keyboardShortcuts = { ...original.keyboardShortcuts, clearPrompt: 'Ctrl+C' }
    preferences.directShortcuts = ['submit', 'abort', 'clearPrompt']
    try {
      const clearPrompt = vi.fn()
      renderProvider(<ActionLayer actions={{ clearPrompt }} />)
      const prompt = mountElement('textarea', { 'data-prompt-input': '' })
      const otherInput = mountElement('textarea')
      const button = mountElement('button')

      expect(pressKey(otherInput, { key: 'c', ctrlKey: true }).defaultPrevented).toBe(false)
      expect(pressKey(button, { key: 'c', ctrlKey: true }).defaultPrevented).toBe(false)
      expect(pressKey(document.body, { key: 'c', ctrlKey: true }).defaultPrevented).toBe(false)
      expect(clearPrompt).not.toHaveBeenCalled()

      expect(pressKey(prompt, { key: 'c', ctrlKey: true }).defaultPrevented).toBe(true)
      expect(clearPrompt).toHaveBeenCalledTimes(1)
    } finally {
      preferences.keyboardShortcuts = original.keyboardShortcuts
      preferences.directShortcuts = original.directShortcuts
    }
  })

  it('runs a direct half-page-down shortcut with Ctrl+D from the body and the prompt', () => {
    const halfPageDown = vi.fn()
    renderProvider(<ActionLayer actions={{ halfPageDown }} />)
    const prompt = mountElement('textarea', { 'data-prompt-input': '' })

    expect(pressKey(document.body, { key: 'd', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(halfPageDown).toHaveBeenCalledTimes(1)

    expect(pressKey(prompt, { key: 'd', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(halfPageDown).toHaveBeenCalledTimes(2)
  })

  it('runs leader and direct shortcuts from a terminal before it consumes the keys, passing other keys through', () => {
    const newSession = vi.fn()
    const toggleTerminal = vi.fn()
    renderProvider(<ActionLayer actions={{ newSession, toggleTerminal }} />)
    const terminal = mountElement('div', { 'data-terminal-id': 'pty-1' })
    const terminalInput = terminal.appendChild(document.createElement('textarea'))
    const shellInput = vi.fn()
    terminalInput.addEventListener('keydown', (event) => {
      shellInput(event.key)
      event.preventDefault()
    })

    pressKey(terminalInput, { key: 'o', ctrlKey: true })
    pressKey(terminalInput, { key: 'n' })
    pressKey(terminalInput, { key: '`', ctrlKey: true })
    pressKey(terminalInput, { key: 'l' })

    expect(newSession).toHaveBeenCalledTimes(1)
    expect(toggleTerminal).toHaveBeenCalledTimes(1)
    expect(shellInput.mock.calls).toEqual([['l']])
  })

  it('ignores key events a component already handled', () => {
    const abort = vi.fn()
    renderProvider(<ActionLayer actions={{ abort }} />)
    const element = mountElement('div')
    element.addEventListener('keydown', (event) => event.preventDefault())

    pressKey(element, { key: 'Escape' })

    expect(abort).not.toHaveBeenCalled()
  })

  it('does not swallow a key whose action has no handler', () => {
    renderProvider(<ActionLayer actions={{ abort: undefined }} />)

    expect(pressKey(document.body, { key: 'Escape' }).defaultPrevented).toBe(false)
  })

  it('prefers a page layer over a global layer for the same action', () => {
    const globalAbort = vi.fn()
    const pageAbort = vi.fn()
    renderProvider(
      <>
        <ActionLayer actions={{ abort: globalAbort }} scope="global" />
        <ActionLayer actions={{ abort: pageAbort }} scope="page" />
      </>
    )

    pressKey(document.body, { key: 'Escape' })

    expect(pageAbort).toHaveBeenCalledTimes(1)
    expect(globalAbort).not.toHaveBeenCalled()
  })

  it('falls through to the global handler when a page layer leaves the action undefined', () => {
    const globalAbort = vi.fn()
    renderProvider(
      <>
        <ActionLayer actions={{ abort: globalAbort }} scope="global" />
        <ActionLayer actions={{ abort: undefined }} scope="page" />
      </>
    )

    pressKey(document.body, { key: 'Escape' })

    expect(globalAbort).toHaveBeenCalledTimes(1)
  })

  it('restores the global handler when a page layer unmounts', () => {
    const globalAbort = vi.fn()
    const pageAbort = vi.fn()
    const view = renderProvider(
      <>
        <ActionLayer actions={{ abort: globalAbort }} scope="global" />
        <ConditionalLayer show actions={{ abort: pageAbort }} />
      </>
    )

    pressKey(document.body, { key: 'Escape' })
    expect(pageAbort).toHaveBeenCalledTimes(1)
    expect(globalAbort).not.toHaveBeenCalled()

    view.rerender(
      <KeyboardShortcutsProvider>
        <ActionLayer actions={{ abort: globalAbort }} scope="global" />
        <ConditionalLayer show={false} actions={{ abort: pageAbort }} />
      </KeyboardShortcutsProvider>
    )

    pressKey(document.body, { key: 'Escape' })
    expect(globalAbort).toHaveBeenCalledTimes(1)
  })

  it('shows the leader indicator after the leader key and hides it after the follow-up key', () => {
    const newSession = vi.fn()
    renderProvider(<ActionLayer actions={{ newSession }} />)

    pressKey(document.body, { key: 'o', ctrlKey: true })
    expect(screen.getByText('Waiting for shortcut key...')).toBeInTheDocument()

    pressKey(document.body, { key: 'n' })
    expect(screen.queryByText('Waiting for shortcut key...')).not.toBeInTheDocument()
    expect(newSession).toHaveBeenCalledTimes(1)
  })

  it('throws when used outside the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useShortcutActions({ abort: vi.fn() }))).toThrow(
      'useShortcutActions must be used within a KeyboardShortcutsProvider'
    )
    consoleError.mockRestore()
  })
})
