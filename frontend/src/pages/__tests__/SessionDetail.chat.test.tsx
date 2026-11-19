import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import type { Chat } from '@opencode-manager/shared/schemas'
import { SessionDetail } from '../SessionDetail'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import { installMatchMedia, installWindowSize } from '@/test/browserFakes'
import { makeSession } from '@/test/fixtures/api'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { sessionPageRoutes } from '@/test/sessionPage'
import type { FetchRoute } from '@/test/fetchFake'

const CHAT_ID = '20260101-120000-abcdef'
const SESSION_ID = 'ses_chat'
const CHAT_SESSION_PATH = `/chats/${CHAT_ID}/sessions/${SESSION_ID}`

const chat: Chat = {
  id: CHAT_ID,
  directory: `/chats/${CHAT_ID}/work`,
  filesPath: `/chats/${CHAT_ID}`,
  createdAt: 1,
}

const chatSession = makeSession({
  id: SESSION_ID,
  title: 'Scratch chat',
  location: { directory: chat.directory },
})

interface ChatSessionOptions {
  route?: string
  chatRespond?: FetchRoute['respond']
  queryClient?: QueryClient
}

function chatDirectoryListing(path: string) {
  return {
    name: 'work',
    path,
    isDirectory: true,
    size: 0,
    children: [],
    lastModified: 0,
  }
}

function chatRoutes(options: ChatSessionOptions): FetchRoute[] {
  return [
    {
      method: 'GET',
      path: '/api/chats/:chatId',
      respond: options.chatRespond ?? (() => ({ json: chat })),
    },
    {
      method: 'GET',
      path: '/api/chats/:chatId/terminals',
      respond: () => ({ json: { terminals: [] } }),
    },
    {
      method: 'GET',
      path: '/api/files',
      respond: () => ({ json: chatDirectoryListing(chat.filesPath) }),
    },
    {
      method: 'GET',
      path: '/api/preview/ports',
      respond: () => ({ json: { enabled: true, ports: [] } }),
    },
  ]
}

function renderChatSession(options: ChatSessionOptions = {}) {
  return renderWithProviders(
    <KeyboardShortcutsProvider>
      <Routes>
        <Route path="/" element={<div>home route</div>} />
        <Route path="/chats/:chatId/sessions/:sessionId" element={<SessionDetail />} />
      </Routes>
    </KeyboardShortcutsProvider>,
    {
      route: options.route ?? CHAT_SESSION_PATH,
      events: true,
      tts: true,
      queryClient: options.queryClient,
      fetchRoutes: sessionPageRoutes({ session: chatSession, extraRoutes: chatRoutes(options) }),
    },
  )
}

async function waitForComposer() {
  await waitFor(() => {
    expect(document.querySelector('[data-prompt-input]')).not.toBeNull()
  })
}

beforeEach(() => {
  installMatchMedia(false)
  installWindowSize(900)
})

describe('SessionDetail chat session', () => {
  it('renders the transcript and labels the project as a chat', async () => {
    const { fetchFake } = renderChatSession()

    await waitForComposer()

    expect(screen.getByText('No messages yet. Start a conversation below.')).toBeInTheDocument()
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(
      fetchFake.findRequests('GET', '/api/opencode/api/session/:sessionId/message').length,
    ).toBeGreaterThan(0)
  })

  it('does not load a Manager repository', async () => {
    const { fetchFake } = renderChatSession()

    await waitForComposer()

    expect(fetchFake.findRequests('GET', '/api/repos/:id')).toHaveLength(0)
  })

  it('scopes the file browser to the chat folder', async () => {
    const { fetchFake } = renderChatSession({ route: `${CHAT_SESSION_PATH}?panel=files` })

    await waitFor(() => {
      expect(fetchFake.lastRequest('GET', '/api/files')?.searchParams.get('path')).toBe(chat.filesPath)
    })
    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument()
  })

  it('opens terminals for the chat folder', async () => {
    const { fetchFake } = renderChatSession({ route: `${CHAT_SESSION_PATH}?panel=terminal` })

    await waitFor(() => {
      expect(
        fetchFake.lastRequest('GET', '/api/chats/:chatId/terminals')?.searchParams.get('directory'),
      ).toBe(chat.directory)
    })
    expect(fetchFake.findRequests('GET', '/api/repos/:id/terminals')).toHaveLength(0)
  })

  it('scopes the preview to the chat folder', async () => {
    const { fetchFake } = renderChatSession({ route: `${CHAT_SESSION_PATH}?panel=preview` })

    await waitFor(() => {
      expect(fetchFake.lastRequest('GET', '/api/preview/ports')?.searchParams.get('directory')).toBe(
        chat.directory,
      )
    })
  })

  it('keeps repository-only tools out of the chat rail', async () => {
    renderChatSession()

    const rail = await screen.findByRole('navigation', { name: 'Tools' })

    for (const label of ['Sessions', 'Files', 'Terminal']) {
      expect(within(rail).getByRole('button', { name: label })).toBeInTheDocument()
    }
    for (const label of [
      'MCP',
      'Skills',
      'Source Control',
      'Walkthrough',
      'Actions',
      'Reset Permissions',
      'Schedules',
      'Secrets',
    ]) {
      expect(within(rail).queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Project actions' })).not.toBeInTheDocument()
  })

  it.each([
    { surface: 'actions', url: '?panel=actions', label: 'Actions' },
    { surface: 'mcp', url: '?panel=mcp', label: 'MCP' },
    { surface: 'skills', url: '?panel=skills', label: 'Skills' },
    { surface: 'source control', url: '?panel=sourceControl', label: 'Source Control' },
    { surface: 'walkthrough', url: '?panel=walkthrough', label: 'Walkthrough' },
    { surface: 'reset permissions', url: '?dialog=resetPermissions', label: 'Reset Permissions' },
  ])('does not open the repository $surface surface for a chat', async ({ url, label }) => {
    installWindowSize(700)

    renderChatSession({ route: `${CHAT_SESSION_PATH}${url}` })

    await waitForComposer()

    expect(screen.queryByRole('dialog', { name: label })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: label })).not.toBeInTheDocument()
  })

  it('shows a chat not-found state for an unknown chat', async () => {
    const { fetchFake } = renderChatSession({
      chatRespond: () => ({ status: 404, json: { error: 'Chat not found' } }),
    })

    expect(await screen.findByText('Chat not found')).toBeInTheDocument()
    expect(document.querySelector('[data-prompt-input]')).toBeNull()
    expect(fetchFake.findRequests('GET', '/api/chats/:chatId')).toHaveLength(1)
  })

  it('shows the load error instead of not-found when the chat request fails', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setDefaultOptions({ queries: { retryDelay: 0 } })

    renderChatSession({
      queryClient,
      chatRespond: () => ({ status: 500, json: { error: 'Chat request failed' } }),
    })

    expect(await screen.findByText('Chat request failed')).toBeInTheDocument()
    expect(screen.queryByText('Chat not found')).not.toBeInTheDocument()
    expect(document.querySelector('[data-prompt-input]')).toBeNull()
  })
})
