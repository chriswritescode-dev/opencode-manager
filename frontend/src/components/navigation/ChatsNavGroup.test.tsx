import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Chat } from '@opencode-manager/shared/schemas'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { ChatsNavGroup } from './ChatsNavGroup'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { makeSession } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'

function chat(id: string, directory: string): Chat {
  return { id, directory, filesPath: `chats/${id}`, createdAt: 1000 }
}

function createSession(id: string, directory: string, updated = Date.now()): SessionInfo {
  return makeSession({ id, title: `Session ${id}`, location: { directory }, time: { created: updated - 10000, updated } })
}

const chatA = chat('20240103-120000-aaaaaa', '/chats/a')
const chatB = chat('20240102-120000-bbbbbb', '/chats/b')
const chatC = chat('20240101-120000-cccccc', '/chats/c')
const chatD = chat('20231231-120000-dddddd', '/chats/d')
const chatE = chat('20231230-120000-eeeeee', '/chats/e')
const chatF = chat('20231229-120000-ffffff', '/chats/f')

const defaultSessions = [
  createSession('a1', '/chats/a'),
  createSession('b1', '/chats/b'),
  createSession('c1', '/chats/c'),
  createSession('d1', '/chats/d'),
  createSession('e1', '/chats/e'),
  createSession('f1', '/chats/f'),
]

interface RenderOptions {
  route?: string
  chats?: readonly Chat[]
  sessions?: readonly SessionInfo[]
  nextCursor?: string
  createdChat?: Chat
}

function chatsRoute(options: RenderOptions): FetchRoute {
  return {
    method: 'GET',
    path: '/api/chats',
    respond: (request) => {
      const cursor = request.searchParams.get('cursor')
      if (cursor === null) {
        const page = (options.chats ?? []).slice(0, 3)
        const nextCursor = options.nextCursor ?? (page.length === 3 ? page[page.length - 1]?.id : undefined)
        return { json: nextCursor === undefined ? { chats: page } : { chats: page, nextCursor } }
      }
      return { json: { chats: (options.chats ?? []).slice(3) } }
    },
  }
}

function createChatRoute(createdChat: Chat): FetchRoute {
  return {
    method: 'POST',
    path: '/api/chats',
    respond: () => ({ json: { chat: createdChat, sessionId: 'ses_new' } }),
  }
}

function renderChatsNav(options: RenderOptions = {}) {
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <ChatsNavGroup />
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
    </>,
    {
      route: options.route ?? '/',
      events: true,
      fetchRoutes: [
        chatsRoute(options),
        createChatRoute(options.createdChat ?? chat('20240104-120000-111111', '/chats/new')),
        ...appRoutes({
          sessions: options.sessions ?? defaultSessions,
          pins: [],
        }),
      ],
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

const chatRows = () => screen.getAllByText(/^Session /).map((row) => row.textContent)

describe('ChatsNavGroup', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('lists the newest chats and loads the next page with Show more', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderChatsNav({ chats: [chatA, chatB, chatC, chatD, chatE, chatF] })

    await screen.findByRole('button', { name: /^Session a1/ })
    expect(chatRows()).toEqual(['Session a1', 'Session b1', 'Session c1'])
    expect(fetchFake.lastRequest('GET', '/api/chats')?.searchParams.get('limit')).toBe('3')

    await user.click(screen.getByText('Show more'))

    await waitFor(() => expect(chatRows()).toHaveLength(6))
    expect(chatRows()).toEqual([
      'Session a1',
      'Session b1',
      'Session c1',
      'Session d1',
      'Session e1',
      'Session f1',
    ])
    expect(fetchFake.lastRequest('GET', '/api/chats')?.searchParams.get('cursor')).toBe(chatC.id)
    expect(screen.queryByText('Show more')).toBeNull()
  })

  it('creates a chat and opens its session from the + button', async () => {
    const user = userEvent.setup()
    const createdChat = chat('20240104-120000-111111', '/chats/new')
    const { capturedPathname, fetchFake } = renderChatsNav({ chats: [chatA, chatB, chatC], createdChat })

    await screen.findByRole('button', { name: /^Session a1/ })
    await user.click(screen.getByRole('button', { name: 'New chat' }))

    await waitFor(() => expect(fetchFake.findRequests('POST', '/api/chats')).toHaveLength(1))
    expect(fetchFake.lastRequest('POST', '/api/chats')?.body).toEqual({})
    await waitFor(() =>
      expect(capturedPathname.current).toBe(`/chats/${createdChat.id}/sessions/ses_new`),
    )
  })

  it('folds the group and keeps that choice for the next mount', async () => {
    const user = userEvent.setup()
    const firstRender = renderChatsNav({ chats: [chatA, chatB, chatC] })
    const { unmount } = firstRender

    await screen.findByRole('button', { name: /^Session a1/ })
    expect(screen.getByRole('button', { name: 'Show sessions in Chats' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Show sessions in Chats' }))

    expect(screen.getByRole('button', { name: 'Show sessions in Chats' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('button', { name: /^Session a1/ })).toBeNull()

    unmount()
    renderChatsNav({ chats: [chatA, chatB, chatC] })

    expect(screen.getByRole('button', { name: 'Show sessions in Chats' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('button', { name: /^Session a1/ })).toBeNull()
  })

  it('marks the open chat session and group as current', async () => {
    renderChatsNav({ route: `/chats/${chatA.id}/sessions/a1`, chats: [chatA, chatB, chatC] })

    expect(await screen.findByRole('button', { name: /^Session a1/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: /^Session b1/ })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Chats' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows an empty state when there are no chats', async () => {
    renderChatsNav({ chats: [] })

    expect(await screen.findByText('No chats')).toBeTruthy()
    expect(screen.queryByText('Show more')).toBeNull()
  })

  it('keeps Show more available when the loaded chats have no visible sessions', async () => {
    renderChatsNav({ chats: [chatA, chatB, chatC, chatD, chatE, chatF], sessions: [] })

    expect(await screen.findByText('No chats')).toBeTruthy()
    expect(screen.getByText('Show more')).toBeTruthy()
  })
})
