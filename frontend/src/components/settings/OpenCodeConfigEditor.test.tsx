import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenCodeConfigEditor } from './OpenCodeConfigEditor'
import type { OpenCodeConfig } from '@/api/types/settings'

const RAW = `{
  "$schema": "https://opencode.ai/config.json",
  "theme": "system",
  "model": "anthropic/claude-sonnet-4"
}`

const config: OpenCodeConfig = {
  id: 1,
  name: 'default',
  content: {},
  rawContent: RAW,
  isValid: true,
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
}

function setContent(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } })
}

describe('OpenCodeConfigEditor', () => {
  const renderEditor = (
    overrides: Partial<React.ComponentProps<typeof OpenCodeConfigEditor>> = {},
  ) => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const result = render(
      <OpenCodeConfigEditor
        config={config}
        isOpen
        onClose={onClose}
        onUpdate={onUpdate}
        {...overrides}
      />,
    )
    return { ...result, onUpdate, onClose }
  }

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 })
  })

  it('loads rawContent verbatim into the editor', () => {
    renderEditor()
    expect(screen.getByLabelText('Config content')).toHaveValue(RAW)
  })

  it('renders a line number gutter', () => {
    renderEditor()
    const numbers = Array.from(document.body.querySelectorAll('[data-line-number]'))
    expect(numbers.map((n) => n.textContent?.trim())).toEqual(['1', '2', '3', '4', '5'])
  })

  it('does not autofocus the editor on a mobile viewport', () => {
    renderEditor()
    expect(screen.getByLabelText('Config content')).not.toHaveFocus()
  })

  it('does not autofocus the find input on a mobile viewport', () => {
    renderEditor()
    expect(screen.getByLabelText('Find in content')).not.toHaveFocus()
  })

  it('autofocuses the editor on a desktop viewport', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 })
    renderEditor()
    expect(screen.getByLabelText('Config content')).toHaveFocus()
    expect(screen.getByLabelText('Find in content')).not.toHaveFocus()
  })

  it('keeps the footer actions inside the layout flow', () => {
    renderEditor()
    const updateBtn = screen.getByRole('button', { name: 'Update' })
    const footer = updateBtn.closest('[data-editor-footer]')
    expect(footer).toBeInTheDocument()
    let ancestor: Element | null = footer
    while (ancestor && ancestor !== document.body) {
      expect(ancestor.className || '').not.toMatch(/\babsolute\b/)
      ancestor = ancestor.parentElement
    }
  })

  it('surfaces a JSONC syntax error with the offending line', async () => {
    const user = userEvent.setup()
    renderEditor()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, '{\n  "a" 1\n}')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => {
      expect(screen.getByText(/Invalid JSON\/JSONC/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Go to line 2/ })).toBeInTheDocument()
  })

  it('jumps to the syntax error line when the error line button is pressed', async () => {
    const { onUpdate } = renderEditor()
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, '{\n  "a" 1\n}')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    const goButton = await screen.findByRole('button', { name: /Go to line 2/ })
    await user.click(goButton)
    const activeLine = document.body.querySelector('[data-active-line]')
    const row = activeLine?.closest('[data-line]')
    expect(row).toHaveAttribute('data-line', '2')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('recenters the syntax error line on repeated clicks', async () => {
    const user = userEvent.setup()
    renderEditor()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, '{\n  "a" 1\n}')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    const goButton = await screen.findByRole('button', { name: /Go to line 2/ })
    let scrollTopSets = 0
    Object.defineProperty(textarea, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: () => {
        scrollTopSets += 1
      },
    })
    await user.click(goButton)
    await user.click(goButton)
    expect(scrollTopSets).toBeGreaterThanOrEqual(2)
  })

  it('lists schema validation issues as line jumps', async () => {
    const user = userEvent.setup()
    renderEditor()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, '{\n  "theme": 42\n}')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    const issueButton = await screen.findByRole('button', { name: /theme/i })
    expect(issueButton).toBeInTheDocument()
    await user.click(issueButton)
    const activeLine = document.body.querySelector('[data-active-line]')
    const row = activeLine?.closest('[data-line]')
    expect(row).toHaveAttribute('data-line', '2')
  })

  it('does not call onUpdate when local validation fails', async () => {
    const { onUpdate } = renderEditor()
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, '{\n  "theme": 42\n}')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => {
      expect(screen.getByText(/Configuration validation failed/)).toBeInTheDocument()
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('saves the raw text including comments', async () => {
    const { onUpdate, onClose } = renderEditor()
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    const next = '{\n  // keep me\n  "theme": "system"\n}'
    setContent(textarea, next)
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(next)
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('clears errors as soon as the content changes', async () => {
    const user = userEvent.setup()
    renderEditor()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, '{\n  "a" 1\n}')
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => {
      expect(screen.getByText(/Invalid JSON\/JSONC/)).toBeInTheDocument()
    })
    setContent(textarea, '{\n  "a" 1\n} ')
    expect(screen.queryByText(/Invalid JSON\/JSONC/)).not.toBeInTheDocument()
  })

  it('renders find matches and reports the counter', async () => {
    const user = userEvent.setup()
    renderEditor()
    const findInput = screen.getByLabelText('Find in content')
    await user.type(findInput, 'theme')
    const counter = await screen.findByTestId('find-match-count')
    expect(counter).toHaveTextContent('1 of 1')
    expect(document.body.querySelectorAll('mark').length).toBeGreaterThan(0)
  })

  it('does not prompt when closing without edits', async () => {
    const { onClose } = renderEditor()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
  })

  it('prompts before discarding edits', async () => {
    const { onClose } = renderEditor()
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, RAW + ' ')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps editing when the prompt is dismissed', async () => {
    const { onClose } = renderEditor()
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, RAW + ' ')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Keep Editing' }))
    expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(textarea).toHaveValue(RAW + ' ')
  })

  it('discards edits when confirmed', async () => {
    const { onClose } = renderEditor()
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, RAW + ' ')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('prompts on Escape when there are edits', async () => {
    const { onClose } = renderEditor()
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    await user.click(textarea)
    setContent(textarea, RAW + ' ')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a spinner and blocks re-submission while saving', async () => {
    let resolveSave: () => void = () => {}
    const onUpdate = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveSave = resolve
      }),
    )
    const onClose = vi.fn()
    render(
      <OpenCodeConfigEditor
        config={config}
        isOpen
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    )
    const user = userEvent.setup()
    const updateBtn = screen.getByRole('button', { name: 'Update' })
    await user.click(updateBtn)
    await waitFor(() => expect(updateBtn).toBeDisabled())
    await user.click(updateBtn)
    resolveSave()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('re-enables Update after a failed save', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('boom'))
    const onClose = vi.fn()
    render(
      <OpenCodeConfigEditor
        config={config}
        isOpen
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    )
    const user = userEvent.setup()
    const updateBtn = screen.getByRole('button', { name: 'Update' })
    await user.click(updateBtn)
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
    await waitFor(() => expect(updateBtn).not.toBeDisabled())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('locks the editor against edits while a save is pending', async () => {
    let resolveSave: () => void = () => {}
    const onUpdate = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveSave = resolve
      }),
    )
    const onClose = vi.fn()
    render(
      <OpenCodeConfigEditor
        config={config}
        isOpen
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    )
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    expect(textarea).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(textarea).toBeDisabled())
    try {
      await user.type(textarea, ' extra')
    } catch {
      // user-event refuses to type into a disabled element; expected
    }
    expect(textarea).toHaveValue(RAW)
    resolveSave()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith(RAW)
  })

  it('resolves a validation issue under a dotted provider key to its line', async () => {
    const user = userEvent.setup()
    renderEditor()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    const dotted = '{\n  "provider": {\n    "api.example.com": {\n      "key": 123\n    }\n  }\n}'
    setContent(textarea, dotted)
    await user.click(screen.getByRole('button', { name: 'Update' }))
    const issueButton = await screen.findByRole('button', { name: /api\.example\.com/i })
    expect(issueButton).toBeInTheDocument()
    await user.click(issueButton)
    const activeLine = document.body.querySelector('[data-active-line]')
    const row = activeLine?.closest('[data-line]')
    expect(row).toHaveAttribute('data-line', '4')
  })
})
