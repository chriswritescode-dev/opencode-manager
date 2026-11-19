import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenCodeConfigEditor } from './OpenCodeConfigEditor'
import { makeOpenCodeConfigFile, makeOpenCodeConfigSource } from '@/test/fixtures/opencode-config'
import { FetchError } from '@/api/fetchWrapper'
import { renderWithProviders } from '@/test/render'
import { installObjectUrl, installPointerCapture, installWindowSize } from '@/test/browserFakes'

const RAW = `{
  "$schema": "https://opencode.ai/config.json",
  "theme": "system",
  "model": "anthropic/claude-sonnet-4"
}`

const JSONC_RAW = `{
  // preferred target keeps comments
  "theme": "system"
}`

const config = makeOpenCodeConfigFile({ rawContent: RAW })

const multiSourceConfig = makeOpenCodeConfigFile({
  path: '/workspace/.config/opencode/opencode.jsonc',
  rawContent: JSONC_RAW,
  revision: 'rev-2',
  sources: [
    makeOpenCodeConfigSource({ name: 'opencode.jsonc', path: '/workspace/.config/opencode/opencode.jsonc', rawContent: JSONC_RAW }),
    makeOpenCodeConfigSource({ name: 'opencode.json', path: '/workspace/.config/opencode/opencode.json', rawContent: RAW }),
  ],
})

function setContent(textarea: HTMLElement, value: string) {
  fireEvent.change(textarea, { target: { value } })
}

function renderEditor(
  overrides: Partial<Parameters<typeof OpenCodeConfigEditor>[0]> = {},
) {
  const onUpdate = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  const result = renderWithProviders(
    <OpenCodeConfigEditor config={config} isOpen onClose={onClose} onUpdate={onUpdate} {...overrides} />,
    { auth: false, theme: false, tts: false },
  )
  return { ...result, onUpdate, onClose }
}

function configContent() {
  return screen.getByLabelText('Config content')
}

function detailsFor(title: string) {
  const details = screen.getByText(title).closest('details')
  if (!(details instanceof HTMLDetailsElement)) throw new Error('details not found')
  return details
}

describe('OpenCodeConfigEditor', () => {
  beforeAll(() => {
    installPointerCapture()
  })

  beforeEach(() => {
    installWindowSize(375)
  })

  it('loads rawContent verbatim into the editor', () => {
    renderEditor()

    expect(configContent()).toHaveValue(RAW)
  })

  it('renders a line number gutter', () => {
    renderEditor()

    const numbers = Array.from(document.body.querySelectorAll('[data-line-number]'))
    expect(numbers.map((n) => n.textContent?.trim())).toEqual(['1', '2', '3', '4', '5'])
  })

  it('does not autofocus the editor on a mobile viewport', () => {
    renderEditor()

    expect(configContent()).not.toHaveFocus()
  })

  it('does not autofocus the find input on a mobile viewport', () => {
    renderEditor()

    expect(screen.getByLabelText('Find in content')).not.toHaveFocus()
  })

  it('autofocuses the editor on a desktop viewport', () => {
    installWindowSize(1280)
    renderEditor()

    expect(configContent()).toHaveFocus()
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
    setContent(configContent(), '{\n  "a" 1\n}')

    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(screen.getByText(/Invalid JSON\/JSONC/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Go to line 2/ })).toBeInTheDocument()
  })

  it('jumps to the syntax error line when the error line button is pressed', async () => {
    const { onUpdate } = renderEditor()
    const user = userEvent.setup()
    setContent(configContent(), '{\n  "a" 1\n}')
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await user.click(await screen.findByRole('button', { name: /Go to line 2/ }))

    const activeLine = document.body.querySelector('[data-active-line]')
    expect(activeLine?.closest('[data-line]')).toHaveAttribute('data-line', '2')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('recenters the syntax error line on repeated clicks', async () => {
    const user = userEvent.setup()
    renderEditor()
    const textarea = configContent()
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

  it('lists backend validation issues as line jumps', async () => {
    const onUpdate = vi.fn().mockRejectedValue(
      new FetchError('Invalid config data', 400, undefined, undefined, {
        validationIssues: [{ path: 'theme', message: 'Expected string' }],
      }),
    )
    renderEditor({ onUpdate })
    const user = userEvent.setup()
    setContent(configContent(), '{\n  "theme": 42\n}')
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const issueButton = await screen.findByRole('button', { name: /theme/i })
    await user.click(issueButton)

    const activeLine = document.body.querySelector('[data-active-line]')
    expect(activeLine?.closest('[data-line]')).toHaveAttribute('data-line', '2')
  })

  it('sends content the browser cannot validate to the backend instead of rejecting it locally', async () => {
    const onUpdate = vi.fn().mockRejectedValue(
      new FetchError('Invalid config data', 400, undefined, undefined, {
        validationIssues: [{ path: 'theme', message: 'Expected string' }],
      }),
    )
    renderEditor({ onUpdate })
    const user = userEvent.setup()
    const invalid = '{\n  "theme": 42\n}'
    setContent(configContent(), invalid)

    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({ content: invalid, source: 'opencode.json', expectedRevision: 'rev-1' })
    })
    expect(await screen.findByText(/theme: Expected string/)).toBeInTheDocument()
  })

  it('saves the raw text including comments', async () => {
    const { onUpdate, onClose } = renderEditor()
    const user = userEvent.setup()
    const next = '{\n  // keep me\n  "theme": "system"\n}'
    setContent(configContent(), next)

    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({ content: next, source: 'opencode.json', expectedRevision: 'rev-1' })
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('clears errors as soon as the content changes', async () => {
    const user = userEvent.setup()
    renderEditor()
    const textarea = configContent()
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

    await user.type(screen.getByLabelText('Find in content'), 'theme')

    expect(await screen.findByTestId('find-match-count')).toHaveTextContent('1 of 1')
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
    setContent(configContent(), `${RAW} `)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps editing when the prompt is dismissed', async () => {
    const { onClose } = renderEditor()
    const user = userEvent.setup()
    const textarea = configContent()
    setContent(textarea, `${RAW} `)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Keep Editing' }))

    expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(textarea).toHaveValue(`${RAW} `)
  })

  it('discards edits when confirmed', async () => {
    const { onClose } = renderEditor()
    const user = userEvent.setup()
    setContent(configContent(), `${RAW} `)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('prompts on Escape when there are edits', async () => {
    const { onClose } = renderEditor()
    const user = userEvent.setup()
    const textarea = configContent()
    await user.click(textarea)
    setContent(textarea, `${RAW} `)

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
      <OpenCodeConfigEditor config={config} isOpen onClose={onClose} onUpdate={onUpdate} />,
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
      <OpenCodeConfigEditor config={config} isOpen onClose={onClose} onUpdate={onUpdate} />,
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
      <OpenCodeConfigEditor config={config} isOpen onClose={onClose} onUpdate={onUpdate} />,
    )
    const user = userEvent.setup()
    const textarea = configContent()
    expect(textarea).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(textarea).toBeDisabled())
    await user.type(textarea, ' extra').catch(() => undefined)
    expect(textarea).toHaveValue(RAW)

    resolveSave()

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ content: RAW, source: 'opencode.json', expectedRevision: 'rev-1' })
  })

  it('resolves a nested backend validation issue to its line', async () => {
    const onUpdate = vi.fn().mockRejectedValue(
      new FetchError('Invalid config data', 400, undefined, undefined, {
        validationIssues: [{ path: 'agents.assistant.mode', message: 'Expected a known mode' }],
      }),
    )
    renderEditor({ onUpdate })
    const user = userEvent.setup()
    const nested = '{\n  "agents": {\n    "assistant": {\n      "mode": 42\n    }\n  }\n}'
    setContent(configContent(), nested)
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await user.click(await screen.findByRole('button', { name: /agents\.assistant\.mode/i }))

    const activeLine = document.body.querySelector('[data-active-line]')
    expect(activeLine?.closest('[data-line]')).toHaveAttribute('data-line', '4')
  })

  it('loads the preferred source and lists every source file', () => {
    renderEditor({ config: multiSourceConfig })

    expect(screen.getByText('Edit opencode.jsonc')).toBeInTheDocument()
    expect(configContent()).toHaveValue(JSONC_RAW)
    expect(screen.getByText('/workspace/.config/opencode/opencode.jsonc')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Source file' })).toBeInTheDocument()
  })

  it('switches sources without discarding and saves the selected source', async () => {
    const { onUpdate } = renderEditor({ config: multiSourceConfig })
    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: 'Source file' }))
    await user.click(screen.getByRole('option', { name: 'opencode.json' }))

    expect(screen.getByText('Edit opencode.json')).toBeInTheDocument()
    expect(screen.getByText('/workspace/.config/opencode/opencode.json')).toBeInTheDocument()
    const textarea = configContent()
    expect(textarea).toHaveValue(RAW)

    const next = '{\n  "theme": "light"\n}'
    setContent(textarea, next)
    await user.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({ content: next, source: 'opencode.json', expectedRevision: 'rev-2' })
    })
  })

  it('disables the source selector while there are unsaved edits', async () => {
    const { onClose } = renderEditor({ config: multiSourceConfig })
    const user = userEvent.setup()
    setContent(configContent(), `${JSONC_RAW} `)

    expect(screen.getByRole('combobox', { name: 'Source file' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('downloads the exact selected source file', async () => {
    const { createObjectURL } = installObjectUrl()
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function method(this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    renderEditor({ config: multiSourceConfig })
    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: 'Source file' }))
    await user.click(screen.getByRole('option', { name: 'opencode.json' }))
    await user.click(screen.getByRole('button', { name: 'Download' }))

    expect(downloads).toEqual(['opencode.json'])
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('surfaces a conflict error without discarding the raw text', async () => {
    const onUpdate = vi.fn().mockRejectedValue(
      new FetchError('Conflict', 409, 'CONFIG_CONFLICT', 'This configuration changed since you opened it.'),
    )
    renderEditor({ onUpdate })
    const user = userEvent.setup()
    const textarea = configContent()
    const next = `${RAW} `
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
    function Harness({ currentConfig }: { currentConfig: ReturnType<typeof makeOpenCodeConfigFile> }) {
      return <OpenCodeConfigEditor config={currentConfig} isOpen onClose={onClose} onUpdate={onUpdate} />
    }
    const { rerender } = render(<Harness currentConfig={config} />)
    const user = userEvent.setup()
    const textarea = configContent()
    const draft = `${RAW} `
    setContent(textarea, draft)

    rerender(<Harness currentConfig={makeOpenCodeConfigFile({ rawContent: RAW, revision: 'rev-2', updatedAt: 2 })} />)

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
    function Harness({ currentConfig }: { currentConfig: ReturnType<typeof makeOpenCodeConfigFile> }) {
      return <OpenCodeConfigEditor config={currentConfig} isOpen onClose={onClose} onUpdate={onUpdate} />
    }
    const { rerender } = render(<Harness currentConfig={multiSourceConfig} />)
    const user = userEvent.setup()
    const textarea = configContent()
    const draft = `${JSONC_RAW}\n// draft\n`
    setContent(textarea, draft)

    rerender(
      <Harness
        currentConfig={makeOpenCodeConfigFile({
          path: '/workspace/.config/opencode/opencode.json',
          rawContent: RAW,
          revision: 'rev-3',
          updatedAt: 3,
          sources: [
            makeOpenCodeConfigSource({ name: 'opencode.json', path: '/workspace/.config/opencode/opencode.json', rawContent: RAW }),
          ],
        })}
      />,
    )

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

    const details = detailsFor('Multiple configuration files are merged')
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
    const details = detailsFor('Multiple configuration files are merged')
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
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    function Harness({ currentConfig }: { currentConfig: ReturnType<typeof makeOpenCodeConfigFile> }) {
      return <OpenCodeConfigEditor config={currentConfig} isOpen onClose={onClose} onUpdate={onUpdate} />
    }
    const { rerender } = render(<Harness currentConfig={multiSourceConfig} />)

    const title = screen.getByText('Multiple configuration files are merged')
    await user.click(title)
    expect(title.closest('details')).not.toHaveAttribute('open')

    rerender(<Harness currentConfig={makeOpenCodeConfigFile({ ...multiSourceConfig, revision: 'rev-3', updatedAt: 2 })} />)

    const refreshedDetails = detailsFor('Multiple configuration files are merged')
    expect(refreshedDetails).not.toHaveAttribute('open')
    const refreshedParagraphs = Array.from(refreshedDetails.querySelectorAll('p'))
    expect(refreshedParagraphs).toHaveLength(3)
    refreshedParagraphs.forEach((paragraph) => {
      expect(paragraph).not.toBeVisible()
    })
  })

  it('lists merged config files and names the selected source as the write target', () => {
    renderEditor({ config: multiSourceConfig })

    const notice = screen.getByText('Multiple configuration files are merged').closest('[role="alert"]')
    if (!(notice instanceof HTMLElement)) throw new Error('notice not found')
    expect(notice).toHaveTextContent('opencode.json, opencode.jsonc')
    expect(notice).toHaveTextContent('Saves apply only to opencode.jsonc')
    expect(notice).toHaveTextContent('For simpler configuration, consolidate the settings you need into one file, then remove redundant files after verifying the result.')
    expect(notice.closest('.overflow-y-auto')).toHaveClass('max-h-[45dvh]')
  })

  it('updates the write target when the source selection changes', async () => {
    renderEditor({ config: multiSourceConfig })
    const user = userEvent.setup()

    const notice = screen.getByText('Multiple configuration files are merged').closest('[role="alert"]')
    expect(notice).toHaveTextContent('Saves apply only to opencode.jsonc')

    await user.click(screen.getByRole('combobox', { name: 'Source file' }))
    await user.click(screen.getByRole('option', { name: 'opencode.json' }))

    const updatedNotice = screen.getByText('Multiple configuration files are merged').closest('[role="alert"]')
    expect(updatedNotice).toHaveTextContent('Saves apply only to opencode.json')
  })

  it('shows the file details disclosure expanded for a single source', () => {
    renderEditor()

    expect(detailsFor('File details')).toHaveAttribute('open')
    expect(screen.getByText('/workspace/.config/opencode/opencode.json')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Download' })).toBeVisible()
    expect(screen.getByText(/Editing this file directly/)).toBeVisible()
  })

  it('hides path, guidance and download when the file details are collapsed', async () => {
    const user = userEvent.setup()
    renderEditor()

    const summary = screen.getByText('File details')
    const details = detailsFor('File details')

    await user.click(summary)

    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('/workspace/.config/opencode/opencode.json')).not.toBeVisible()
    expect(screen.getByText(/Editing this file directly/)).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Download' })).not.toBeVisible()
    expect(configContent()).toBeVisible()
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
  })

  it('reopens the file details disclosure from its summary', async () => {
    const user = userEvent.setup()
    renderEditor()

    const summary = screen.getByText('File details')
    const details = detailsFor('File details')

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
    const details = detailsFor('File details')
    const summary = label.closest('summary')
    if (!(summary instanceof HTMLElement)) throw new Error('summary not found')
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
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    function Harness({ currentConfig }: { currentConfig: ReturnType<typeof makeOpenCodeConfigFile> }) {
      return <OpenCodeConfigEditor config={currentConfig} isOpen onClose={onClose} onUpdate={onUpdate} />
    }
    const { rerender } = render(<Harness currentConfig={config} />)

    const summary = screen.getByText('File details')
    await user.click(summary)
    expect(summary.closest('details')).not.toHaveAttribute('open')

    setContent(configContent(), `${RAW} `)
    rerender(<Harness currentConfig={makeOpenCodeConfigFile({ rawContent: RAW, revision: 'rev-2', updatedAt: 2 })} />)

    expect(detailsFor('File details')).not.toHaveAttribute('open')
    expect(screen.getByText('/workspace/.config/opencode/opencode.json')).not.toBeVisible()
    expect(configContent()).toBeVisible()
  })

  it('keeps the merged notice chevron tied to its own disclosure', () => {
    renderEditor({ config: multiSourceConfig })

    const noticeDetails = detailsFor('Multiple configuration files are merged')
    const chevron = noticeDetails.querySelector('svg')
    expect(chevron).toHaveClass('group-open:rotate-180')
    expect(chevron).not.toHaveClass('group-open/file-details:rotate-180')

    const fileDetails = detailsFor('File details')
    expect(fileDetails).toHaveClass('group/file-details')
    expect(fileDetails).not.toHaveClass('group')
  })
})
