import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenCodeConfigEditor } from './OpenCodeConfigEditor'
import { makeOpenCodeConfigFile, makeOpenCodeConfigSource } from '@/test/fixtures/opencode-config'
import { FetchError } from '@/api/fetchWrapper'
import { saveFile } from '@/lib/download'

vi.mock('@/lib/download', () => ({
  saveFile: vi.fn().mockResolvedValue(true),
}))

const RAW = `{
  "$schema": "https://opencode.ai/config.json",
  "theme": "system",
  "model": "anthropic/claude-sonnet-4"
}`

const JSONC_RAW = `{
  // preferred target keeps comments
  "theme": "system"
}`

const CONFIG_JSON_RAW = `{
  "theme": "dark"
}`

const config = makeOpenCodeConfigFile({ rawContent: RAW })

const multiSourceConfig = makeOpenCodeConfigFile({
  path: '/workspace/.config/opencode/opencode.jsonc',
  rawContent: JSONC_RAW,
  revision: 'rev-2',
  sources: [
    makeOpenCodeConfigSource({ name: 'opencode.jsonc', path: '/workspace/.config/opencode/opencode.jsonc', rawContent: JSONC_RAW }),
    makeOpenCodeConfigSource({ name: 'opencode.json', path: '/workspace/.config/opencode/opencode.json', rawContent: RAW }),
    makeOpenCodeConfigSource({ name: 'config.json', path: '/workspace/.config/opencode/config.json', rawContent: CONFIG_JSON_RAW }),
  ],
})

function setContent(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } })
}

describe('OpenCodeConfigEditor', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
  })

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
      expect(onUpdate).toHaveBeenCalledWith({ content: next, source: 'opencode.json', expectedRevision: 'rev-1' })
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
    expect(onUpdate).toHaveBeenCalledWith({ content: RAW, source: 'opencode.json', expectedRevision: 'rev-1' })
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

  it('loads the preferred source and lists every source file', () => {
    renderEditor({ config: multiSourceConfig })
    expect(screen.getByText('Edit opencode.jsonc')).toBeInTheDocument()
    expect(screen.getByLabelText('Config content')).toHaveValue(JSONC_RAW)
    expect(screen.getByText('/workspace/.config/opencode/opencode.jsonc')).toBeInTheDocument()
    const selector = screen.getByRole('combobox', { name: 'Source file' })
    expect(selector).toBeInTheDocument()
  })

  it('switches sources without discarding and saves the selected source', async () => {
    const { onUpdate } = renderEditor({ config: multiSourceConfig })
    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: 'Source file' }))
    await user.click(screen.getByRole('option', { name: 'config.json' }))

    expect(screen.getByText('Edit config.json')).toBeInTheDocument()
    expect(screen.getByText('/workspace/.config/opencode/config.json')).toBeInTheDocument()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    expect(textarea).toHaveValue(CONFIG_JSON_RAW)

    const next = '{\n  "theme": "light"\n}'
    setContent(textarea, next)
    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({ content: next, source: 'config.json', expectedRevision: 'rev-2' })
    })
  })

  it('disables the source selector while there are unsaved edits', async () => {
    const { onClose } = renderEditor({ config: multiSourceConfig })
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, JSONC_RAW + ' ')
    expect(screen.getByRole('combobox', { name: 'Source file' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('downloads the exact selected source file', async () => {
    renderEditor({ config: multiSourceConfig })
    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: 'Source file' }))
    await user.click(screen.getByRole('option', { name: 'config.json' }))
    await user.click(screen.getByRole('button', { name: 'Download' }))

    expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'config.json')
  })

  it('surfaces a conflict error without discarding the raw text', async () => {
    const onUpdate = vi.fn().mockRejectedValue(
      new FetchError('Conflict', 409, 'CONFIG_CONFLICT', 'This configuration changed since you opened it.'),
    )
    renderEditor({ onUpdate })
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    const next = RAW + ' '
    setContent(textarea, next)
    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(await screen.findByText('This configuration changed since you opened it.')).toBeInTheDocument()
    expect(textarea).toHaveValue(next)
    expect(screen.getByText('Edit opencode.json')).toBeInTheDocument()
  })

  it('keeps the captured revision when the config refreshes with a newer revision while dirty', async () => {
    const onUpdate = vi.fn().mockRejectedValue(
      new FetchError('Conflict', 409, 'CONFIG_CONFLICT', 'This configuration changed since you opened it.'),
    )
    const onClose = vi.fn()
    const { rerender } = render(
      <OpenCodeConfigEditor config={config} isOpen onClose={onClose} onUpdate={onUpdate} />,
    )
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    const draft = RAW + ' '
    setContent(textarea, draft)

    const newerConfig = makeOpenCodeConfigFile({ rawContent: RAW, revision: 'rev-2', updatedAt: 2 })
    rerender(<OpenCodeConfigEditor config={newerConfig} isOpen onClose={onClose} onUpdate={onUpdate} />)

    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({ content: draft, source: 'opencode.json', expectedRevision: 'rev-1' })
    })
    expect(await screen.findByText('This configuration changed since you opened it.')).toBeInTheDocument()
    expect(textarea).toHaveValue(draft)
    expect(screen.getByText('Edit opencode.json')).toBeInTheDocument()
  })

  it('keeps the captured source when it disappears from the refreshed config while dirty', async () => {
    const onUpdate = vi.fn().mockRejectedValue(
      new FetchError('Conflict', 409, 'CONFIG_CONFLICT', 'This configuration changed since you opened it.'),
    )
    const onClose = vi.fn()
    const { rerender } = render(
      <OpenCodeConfigEditor config={multiSourceConfig} isOpen onClose={onClose} onUpdate={onUpdate} />,
    )
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    const draft = JSONC_RAW + '\n// draft\n'
    setContent(textarea, draft)

    const sourceRemovedConfig = makeOpenCodeConfigFile({
      path: '/workspace/.config/opencode/opencode.json',
      rawContent: RAW,
      revision: 'rev-3',
      updatedAt: 3,
      sources: [
        makeOpenCodeConfigSource({ name: 'opencode.json', path: '/workspace/.config/opencode/opencode.json', rawContent: RAW }),
        makeOpenCodeConfigSource({ name: 'config.json', path: '/workspace/.config/opencode/config.json', rawContent: CONFIG_JSON_RAW }),
      ],
    })
    rerender(<OpenCodeConfigEditor config={sourceRemovedConfig} isOpen onClose={onClose} onUpdate={onUpdate} />)

    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({ content: draft, source: 'opencode.jsonc', expectedRevision: 'rev-2' })
    })
    expect(await screen.findByText('This configuration changed since you opened it.')).toBeInTheDocument()
    expect(textarea).toHaveValue(draft)
    expect(screen.getByText('Edit opencode.jsonc')).toBeInTheDocument()
  })

  it('hides the multi-source notice for a single config source', () => {
    renderEditor()
    expect(screen.queryByText('Multiple configuration files are merged')).not.toBeInTheDocument()
  })

  it('renders the merged notice expanded with its body visible', () => {
    renderEditor({ config: multiSourceConfig })

    const details = screen.getByText('Multiple configuration files are merged').closest('details') as HTMLDetailsElement
    expect(details).toHaveAttribute('open')
    const paragraphs = Array.from(details.querySelectorAll('p'))
    expect(paragraphs).toHaveLength(3)
    paragraphs.forEach((paragraph) => {
      expect(paragraph).toBeVisible()
    })
  })

  it('collapses and reopens the merged notice from its title', async () => {
    const user = userEvent.setup()
    renderEditor({ config: multiSourceConfig })

    const title = screen.getByText('Multiple configuration files are merged')
    const details = title.closest('details') as HTMLDetailsElement
    expect(title).toBeVisible()
    const paragraphs = Array.from(details.querySelectorAll('p'))
    expect(paragraphs).toHaveLength(3)

    await user.click(title)
    expect(details).not.toHaveAttribute('open')
    paragraphs.forEach((paragraph) => {
      expect(paragraph).not.toBeVisible()
    })
    expect(title).toBeVisible()

    await user.click(title)
    expect(details).toHaveAttribute('open')
    paragraphs.forEach((paragraph) => {
      expect(paragraph).toBeVisible()
    })
  })

  it('keeps the merged notice collapsed when the config refreshes', async () => {
    const user = userEvent.setup()
    const { rerender, onClose, onUpdate } = renderEditor({ config: multiSourceConfig })

    const title = screen.getByText('Multiple configuration files are merged')
    await user.click(title)
    expect(title.closest('details')).not.toHaveAttribute('open')

    const refreshedConfig = makeOpenCodeConfigFile({
      ...multiSourceConfig,
      revision: 'rev-3',
      updatedAt: 2,
    })
    rerender(
      <OpenCodeConfigEditor config={refreshedConfig} isOpen onClose={onClose} onUpdate={onUpdate} />,
    )

    const refreshedTitle = screen.getByText('Multiple configuration files are merged')
    const refreshedDetails = refreshedTitle.closest('details') as HTMLDetailsElement
    expect(refreshedDetails).not.toHaveAttribute('open')
    const refreshedParagraphs = Array.from(refreshedDetails.querySelectorAll('p'))
    expect(refreshedParagraphs).toHaveLength(3)
    refreshedParagraphs.forEach((paragraph) => {
      expect(paragraph).not.toBeVisible()
    })
  })

  it('lists merged config files and names the selected source as the write target', () => {
    renderEditor({ config: multiSourceConfig })

    const notice = screen.getByText('Multiple configuration files are merged').closest('[role="alert"]') as HTMLElement
    expect(notice).toBeInTheDocument()
    expect(notice).toHaveTextContent('config.json, opencode.json, opencode.jsonc')
    expect(notice).toHaveTextContent('Saves apply only to opencode.jsonc')
    expect(notice).toHaveTextContent('For simpler configuration, consolidate the settings you need into one file, then remove redundant files after verifying the result.')

    const scrollContainer = notice.closest('.overflow-y-auto')
    expect(scrollContainer).toHaveClass('max-h-[45dvh]')
  })

  it('updates the write target when the source selection changes', async () => {
    renderEditor({ config: multiSourceConfig })
    const user = userEvent.setup()

    const notice = screen.getByText('Multiple configuration files are merged').closest('[role="alert"]') as HTMLElement
    expect(notice).toHaveTextContent('Saves apply only to opencode.jsonc')

    await user.click(screen.getByRole('combobox', { name: 'Source file' }))
    await user.click(screen.getByRole('option', { name: 'config.json' }))

    const updatedNotice = screen.getByText('Multiple configuration files are merged').closest('[role="alert"]') as HTMLElement
    expect(updatedNotice).toHaveTextContent('Saves apply only to config.json')
  })

  it('shows the file details disclosure expanded for a single source', () => {
    renderEditor()

    const details = screen.getByText('File details').closest('details') as HTMLDetailsElement
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('/workspace/.config/opencode/opencode.json')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Download' })).toBeVisible()
    expect(screen.getByText(/Editing this file directly/)).toBeVisible()
  })

  it('hides path, guidance and download when the file details are collapsed', async () => {
    const user = userEvent.setup()
    renderEditor()

    const summary = screen.getByText('File details')
    const details = summary.closest('details') as HTMLDetailsElement

    await user.click(summary)

    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('/workspace/.config/opencode/opencode.json')).not.toBeVisible()
    expect(screen.getByText(/Editing this file directly/)).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Download' })).not.toBeVisible()
    expect(screen.getByLabelText('Config content')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
  })

  it('reopens the file details disclosure from its summary', async () => {
    const user = userEvent.setup()
    renderEditor()

    const summary = screen.getByText('File details')
    const details = summary.closest('details') as HTMLDetailsElement

    await user.click(summary)
    expect(details).not.toHaveAttribute('open')

    await user.click(summary)
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('/workspace/.config/opencode/opencode.json')).toBeVisible()
  })

  it('keeps the file details summary keyboard focusable and natively activatable', async () => {
    const user = userEvent.setup()
    renderEditor()

    const label = screen.getByText('File details')
    const details = label.closest('details') as HTMLDetailsElement
    const summary = label.closest('summary') as HTMLElement
    expect(summary).toBeInTheDocument()

    summary.focus()
    expect(summary).toHaveFocus()

    await user.click(summary)
    expect(details).not.toHaveAttribute('open')

    await user.click(summary)
    expect(details).toHaveAttribute('open')
  })

  it('keeps the file details collapsed while editing and when the config refreshes', async () => {
    const user = userEvent.setup()
    const { rerender, onClose, onUpdate } = renderEditor()

    const summary = screen.getByText('File details')
    await user.click(summary)
    expect(summary.closest('details')).not.toHaveAttribute('open')

    const textarea = screen.getByLabelText('Config content') as HTMLTextAreaElement
    setContent(textarea, RAW + ' ')

    const refreshedConfig = makeOpenCodeConfigFile({ rawContent: RAW, revision: 'rev-2', updatedAt: 2 })
    rerender(<OpenCodeConfigEditor config={refreshedConfig} isOpen onClose={onClose} onUpdate={onUpdate} />)

    const refreshedDetails = screen.getByText('File details').closest('details') as HTMLDetailsElement
    expect(refreshedDetails).not.toHaveAttribute('open')
    expect(screen.getByText('/workspace/.config/opencode/opencode.json')).not.toBeVisible()
    expect(screen.getByLabelText('Config content')).toBeVisible()
  })

  it('keeps the merged notice chevron tied to its own disclosure', () => {
    renderEditor({ config: multiSourceConfig })

    const noticeDetails = screen.getByText('Multiple configuration files are merged').closest('details') as HTMLDetailsElement
    const chevron = noticeDetails.querySelector('svg') as SVGElement
    expect(chevron).toHaveClass('group-open:rotate-180')
    expect(chevron).not.toHaveClass('group-open/file-details:rotate-180')

    const fileDetails = screen.getByText('File details').closest('details') as HTMLDetailsElement
    expect(fileDetails).toHaveClass('group/file-details')
    expect(fileDetails).not.toHaveClass('group')
  })
})
