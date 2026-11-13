import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { z } from 'zod'
import { BUILTIN_COMMANDS } from '@/lib/builtinCommands'
import { promptTextarea } from '@/test/promptInput'
import { installClipboard, installMatchMedia, installObjectUrl } from '@/test/browserFakes'
import { makeSession, makeUserMessage } from '@/test/fixtures/api'
import { renderSessionPage, sessionPageStatus } from '@/test/sessionPage'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'

const SESSION_ID = 'session-1'

function userMessage(id: string, text: string): SessionMessageInfo {
  return makeUserMessage({ id, text })
}

function baseSession(revertMessageID?: string) {
  const session = makeSession({ id: SESSION_ID, title: 'Command Session', location: { directory: '/test/repo' } })
  return revertMessageID ? { ...session, revert: { messageID: revertMessageID } } : session
}

async function waitForComposer() {
  await waitFor(() => {
    expect(document.querySelector('[data-prompt-input]')).not.toBeNull()
  })
}

function submitComposer(value: string) {
  fireEvent.change(promptTextarea(), { target: { value } })
  fireEvent.click(screen.getByTitle('Send'))
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(z.string().parse(reader.result))
    reader.onerror = () => reject(new Error('Could not read the exported blob'))
    reader.readAsText(blob)
  })
}

function pagedMessageRespond(pages: {
  newest: { messages: SessionMessageInfo[], nextCursor?: string }
  older?: { messages: SessionMessageInfo[] }
}) {
  return (request: { searchParams: URLSearchParams }) => {
    if (request.searchParams.get('cursor')) {
      return { json: { data: pages.older?.messages ?? [], cursor: {} } }
    }
    return { json: { data: pages.newest.messages, cursor: pages.newest.nextCursor ? { next: pages.newest.nextCursor } : {} } }
  }
}

describe('SessionDetail command actions', () => {
  beforeEach(() => {
    installMatchMedia(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('compacts the session from the composer command', async () => {
    const { fetchFake } = renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer('/compact')
    expect(await screen.findByText('Compaction requested')).toBeInTheDocument()
    expect(fetchFake.findRequests('POST', `/api/opencode/api/session/${SESSION_ID}/compact`)).toHaveLength(1)
  })

  it('reports a failed compaction', async () => {
    renderSessionPage({
      session: baseSession(),
      compactRespond: () => sessionPageStatus(500, { error: 'nope' }),
    })
    await waitForComposer()

    submitComposer('/compact')

    expect(await screen.findByText(/Compact failed:/)).toBeInTheDocument()
  })

  it('renames the session with the command argument', async () => {
    const { fetchFake } = renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer('/rename   New name  ')

    await waitFor(() => {
      expect(fetchFake.lastRequest('PATCH', `/api/opencode/api/session/${SESSION_ID}`)?.body).toEqual({
        title: 'New name',
      })
    })
  })

  it('regenerates the title when the rename command has no argument', async () => {
    const { fetchFake } = renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer('/rename')

    expect(await screen.findByText('Session title regenerated')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchFake.lastRequest('PATCH', `/api/opencode/api/session/${SESSION_ID}`)?.body).toEqual({
        title: '',
      })
    })
  })

  it('reports a failed rename', async () => {
    renderSessionPage({
      session: baseSession(),
      updateSessionRespond: () => sessionPageStatus(500, { error: 'nope' }),
    })
    await waitForComposer()

    submitComposer('/rename New name')

    expect(await screen.findByText(/Rename failed:/)).toBeInTheDocument()
  })

  it('copies the complete history across pages to the clipboard in order', async () => {
    const clipboard = installClipboard()
    renderSessionPage({
      session: baseSession(),
      messageRespond: pagedMessageRespond({
        newest: { messages: [userMessage('3', 'newest-marker'), userMessage('2', 'middle-marker')], nextCursor: 'cursor-1' },
        older: { messages: [userMessage('2', 'middle-marker'), userMessage('1', 'oldest-marker')] },
      }),
    })
    await waitForComposer()

    submitComposer('/copy')

    expect(await screen.findByText('Session transcript copied')).toBeInTheDocument()
    const content = z.string().parse(clipboard.writeText.mock.calls[0]?.[0])
    expect(content.match(/oldest-marker/g)).toHaveLength(1)
    expect(content.match(/middle-marker/g)).toHaveLength(1)
    expect(content.match(/newest-marker/g)).toHaveLength(1)
    expect(content.indexOf('oldest-marker')).toBeLessThan(content.indexOf('middle-marker'))
    expect(content.indexOf('middle-marker')).toBeLessThan(content.indexOf('newest-marker'))
  })

  it('reports a transcript fetch failure while copying', async () => {
    installClipboard()
    renderSessionPage({
      session: baseSession(),
      messageRespond: () => sessionPageStatus(500, { error: 'page fetch failed' }),
    })
    await waitForComposer()

    submitComposer('/copy')

    expect(await screen.findByText('Failed to copy session transcript')).toBeInTheDocument()
    expect(screen.queryByText('Session transcript copied')).not.toBeInTheDocument()
  })

  it('opens the side question dialog with the command argument', async () => {
    renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer('/btw why?')

    expect(await screen.findByText('Side question')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ask a side question')).toHaveValue('why?')
  })

  it('opens the sessions panel from the sessions command on desktop', async () => {
    const { capturedSearch } = renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer('/sessions')

    await waitFor(() => expect(capturedSearch.current).toContain('panel=sessions'))
  })

  it('opens the mobile sessions sheet instead of the panel from the sessions command', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 })
    installMatchMedia(true)
    const { capturedSearch } = renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer('/sessions')

    await waitFor(() => expect(capturedSearch.current).toContain('mobileTab=sessions'))
  })

  it('lists the full session history when forking', async () => {
    renderSessionPage({
      session: baseSession(),
      messages: [userMessage('1', 'first prompt')],
      messageRespond: pagedMessageRespond({
        newest: { messages: [userMessage('1', 'first prompt')], nextCursor: 'cursor-1' },
        older: { messages: [userMessage('2', 'history-only prompt')] },
      }),
    })
    await waitForComposer()

    submitComposer('/fork')

    expect(await screen.findByText('Entire conversation')).toBeInTheDocument()
    expect(await screen.findByText('history-only prompt')).toBeInTheDocument()
  })

  it('forks before the chosen message and pre-fills the composer', async () => {
    const { fetchFake, capturedPathname } = renderSessionPage({
      session: baseSession(),
      messages: [userMessage('1', 'first prompt'), userMessage('2', 'second prompt')],
      messageRespond: pagedMessageRespond({
        newest: { messages: [userMessage('1', 'first prompt'), userMessage('2', 'second prompt')] },
      }),
    })
    await waitForComposer()

    submitComposer('/fork')
    const picker = await screen.findByRole('dialog', { name: 'Fork session' })
    fireEvent.click(within(picker).getByText('second prompt'))

    await waitFor(() => {
      expect(fetchFake.lastRequest('POST', `/api/opencode/api/session/${SESSION_ID}/fork`)?.body).toMatchObject({
        before: '2',
      })
    })
    await waitFor(() => expect(promptTextarea()).toHaveValue('second prompt'))
    await waitFor(() => expect(capturedPathname.current).toBe('/repos/1/sessions/session-2'))
    expect(await screen.findByText('Session forked')).toBeInTheDocument()
  })

  it('pre-fills the composer from a full-history message outside the loaded transcript', async () => {
    const { fetchFake } = renderSessionPage({
      session: baseSession(),
      messages: [userMessage('1', 'first prompt')],
      messageRespond: pagedMessageRespond({
        newest: { messages: [userMessage('1', 'first prompt')], nextCursor: 'cursor-1' },
        older: { messages: [userMessage('2', 'history-only prompt')] },
      }),
    })
    await waitForComposer()

    submitComposer('/fork')
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Fork session' })).getByText('history-only prompt'))

    await waitFor(() => {
      expect(fetchFake.lastRequest('POST', `/api/opencode/api/session/${SESSION_ID}/fork`)?.body).toMatchObject({
        before: '2',
      })
    })
    await waitFor(() => expect(promptTextarea()).toHaveValue('history-only prompt'))
  })

  it('forks the entire conversation without pre-filling the composer', async () => {
    const { fetchFake } = renderSessionPage({
      session: baseSession(),
      messages: [userMessage('1', 'first prompt')],
    })
    await waitForComposer()

    submitComposer('/fork')
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Fork session' })).getByText('Entire conversation'))

    await waitFor(() => {
      expect(fetchFake.findRequests('POST', `/api/opencode/api/session/${SESSION_ID}/fork`)).toHaveLength(1)
    })
    expect(promptTextarea()).toHaveValue('')
  })

  it('closes the fork picker and reports a failed history fetch', async () => {
    renderSessionPage({
      session: baseSession(),
      messageRespond: () => sessionPageStatus(500, { error: 'history failed' }),
    })
    await waitForComposer()

    submitComposer('/fork')

    expect(await screen.findByText('Failed to load messages')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Entire conversation')).not.toBeInTheDocument())
  })

  it('jumps to the chosen message from the timeline picker', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    renderSessionPage({
      session: baseSession(),
      messages: [userMessage('1', 'first prompt'), userMessage('2', 'second prompt')],
    })
    await waitForComposer()

    submitComposer('/timeline')
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Jump to message' })).getByText('second prompt'))

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    const target = document.querySelector('[data-message-id="2"]')
    expect(target).not.toBeNull()
    expect(scrollIntoView.mock.instances.at(-1)).toBe(target)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  it('lists only the loaded transcript in the timeline picker', async () => {
    const { fetchFake } = renderSessionPage({
      session: baseSession(),
      messages: [userMessage('1', 'visible transcript')],
    })
    await waitForComposer()

    submitComposer('/timeline')

    const picker = await screen.findByRole('dialog', { name: 'Jump to message' })
    expect(within(picker).getByText('visible transcript')).toBeInTheDocument()
    expect(fetchFake.findRequests('GET', `/api/opencode/api/session/${SESSION_ID}/message`)).toHaveLength(1)
  })

  it('mounts no picker while no picker mode is active', async () => {
    renderSessionPage({ session: baseSession() })
    await waitForComposer()

    expect(screen.queryByText('Fork session')).not.toBeInTheDocument()
    expect(screen.queryByText('Jump to message')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search messages')).not.toBeInTheDocument()
  })

  it('opens the model picker from the models command', async () => {
    renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer('/models')

    expect(await screen.findByRole('dialog', { name: 'Select model' })).toBeInTheDocument()
  })

  it.each([
    { command: '/mcp', parameter: 'mcp' },
    { command: '/skills', parameter: 'skills' },
    { command: '/walkthrough', parameter: 'walkthrough' },
  ])('opens the $parameter dialog from $command', async ({ command, parameter }) => {
    const { capturedSearch } = renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer(command)

    await waitFor(() => expect(capturedSearch.current).toMatch(new RegExp(`(?:dialog|panel)=${parameter}`)))
  })

  it('opens settings from the help command', async () => {
    const { capturedSearch } = renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer('/help')

    await waitFor(() => expect(capturedSearch.current).toContain('settings=open'))
  })

  it('opens the providers tab from the connect command', async () => {
    const { capturedSearch } = renderSessionPage({ session: baseSession() })
    await waitForComposer()

    submitComposer('/connect')

    await waitFor(() => expect(capturedSearch.current).toContain('settingsTab=providers'))
  })

  it('exports the complete history across pages in oldest-first order', async () => {
    const download = installObjectUrl()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { fetchFake } = renderSessionPage({
      session: baseSession(),
      messageRespond: pagedMessageRespond({
        newest: { messages: [userMessage('3', 'newest-marker'), userMessage('2', 'middle-marker')], nextCursor: 'cursor-1' },
        older: { messages: [userMessage('2', 'middle-marker'), userMessage('1', 'oldest-marker')] },
      }),
    })
    await waitForComposer()

    submitComposer('/export')

    expect(await screen.findByText(/Exported to .*\.md/)).toBeInTheDocument()
    expect(download.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = z.instanceof(Blob).parse(download.createObjectURL.mock.calls[0]?.[0])
    const content = await readBlobText(blob)
    expect(content.match(/oldest-marker/g)).toHaveLength(1)
    expect(content.match(/middle-marker/g)).toHaveLength(1)
    expect(content.match(/newest-marker/g)).toHaveLength(1)
    expect(content.indexOf('oldest-marker')).toBeLessThan(content.indexOf('middle-marker'))
    expect(content.indexOf('middle-marker')).toBeLessThan(content.indexOf('newest-marker'))
    expect(fetchFake.findRequests('GET', `/api/opencode/api/session/${SESSION_ID}/message`).length).toBeGreaterThanOrEqual(2)
  })

  it('does not download a partial export when a later page fails', async () => {
    const download = installObjectUrl()
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderSessionPage({
      session: baseSession(),
      messageRespond: (request) => request.searchParams.get('cursor')
        ? sessionPageStatus(500, { error: 'page fetch failed' })
        : { json: { data: [userMessage('3', 'newest-marker')], cursor: { next: 'cursor-1' } } },
    })
    await waitForComposer()

    submitComposer('/export')

    expect(await screen.findByText('Failed to export session')).toBeInTheDocument()
    expect(anchorClick).not.toHaveBeenCalled()
    expect(download.createObjectURL).not.toHaveBeenCalled()
  })

  it('applies the staged-revert boundary to the complete history', async () => {
    const download = installObjectUrl()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderSessionPage({
      session: baseSession('2'),
      messageRespond: pagedMessageRespond({
        newest: { messages: [userMessage('3', 'newest-marker'), userMessage('2', 'middle-marker')], nextCursor: 'cursor-1' },
        older: { messages: [userMessage('1', 'oldest-marker')] },
      }),
    })
    await waitForComposer()

    submitComposer('/export')

    expect(await screen.findByText(/Exported to .*\.md/)).toBeInTheDocument()
    const blob = z.instanceof(Blob).parse(download.createObjectURL.mock.calls[0]?.[0])
    const content = await readBlobText(blob)
    expect(content).toContain('oldest-marker')
    expect(content).not.toContain('middle-marker')
    expect(content).not.toContain('newest-marker')
  })

  it('hides the floating Clear button while composer suggestions are open', async () => {
    const user = userEvent.setup()
    renderSessionPage({ session: baseSession() })
    await waitForComposer()

    await user.type(promptTextarea(), 'hello')
    expect(await screen.findByRole('button', { name: 'Clear' })).toBeInTheDocument()

    fireEvent.change(promptTextarea(), { target: { value: '/rev' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument())
  })
})

describe('builtin command actions', () => {
  it('maps the help command to the settings action', () => {
    expect(BUILTIN_COMMANDS.find((command) => command.name === 'help')?.action).toBe('showSettings')
  })
})
