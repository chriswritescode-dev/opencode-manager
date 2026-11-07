import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { ChatService } from '../../src/services/chats'
import { createChatRoutes } from '../../src/routes/chats'

function createFakeClient() {
  const session = {
    create: vi.fn(async ({ location }: { location: { directory: string } }) => ({
      id: 'ses_created',
      location,
    })),
    get: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
      id: sessionID,
      location: { directory: '/tmp/other-chat' },
    })),
    remove: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ data: [], cursor: {} })),
  }
  return { client: { api: { session } } as unknown as OpenCodeClient, session }
}

const roots: string[] = []

function createApp(root: string) {
  const fake = createFakeClient()
  const app = new Hono()
  app.route('/chats', createChatRoutes(new ChatService(fake.client, () => root)))
  return { app, ...fake }
}

function createRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'chats-routes-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true })
  }
})

describe('chat routes', () => {
  it('lists chats and pages with the returned cursor', async () => {
    const root = createRoot()
    for (const id of ['20260101-000000-aaaaaa', '20260102-000000-bbbbbb']) {
      mkdirSync(path.join(root, id))
    }
    const { app } = createApp(root)

    const first = await app.request('/chats?limit=1')
    expect(first.status).toBe(200)
    const firstBody = await first.json() as { chats: Array<{ id: string }>; nextCursor?: string }
    expect(firstBody.chats.map((chat) => chat.id)).toEqual(['20260102-000000-bbbbbb'])
    expect(firstBody.nextCursor).toBe('20260102-000000-bbbbbb')

    const second = await app.request(`/chats?limit=1&cursor=${firstBody.nextCursor}`)
    const secondBody = await second.json() as { chats: Array<{ id: string }>; nextCursor?: string }
    expect(secondBody.chats.map((chat) => chat.id)).toEqual(['20260101-000000-aaaaaa'])
    expect(secondBody.nextCursor).toBeUndefined()
  })

  it('rejects an invalid limit', async () => {
    const { app } = createApp(createRoot())

    const res = await app.request('/chats?limit=0')
    expect(res.status).toBe(400)
  })

  it('returns a chat and 404 for unknown or malformed ids', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    mkdirSync(path.join(root, id))
    const { app } = createApp(root)

    const found = await app.request(`/chats/${id}`)
    expect(found.status).toBe(200)
    const body = await found.json() as { id: string; directory: string }
    expect(body.id).toBe(id)
    expect(body.directory).toBe(path.join(root, id))

    expect((await app.request('/chats/20260203-040506-aaaaaa')).status).toBe(404)
    expect((await app.request('/chats/not-a-chat')).status).toBe(404)
  })

  it('creates a chat from an empty body', async () => {
    const root = createRoot()
    const { app, session } = createApp(root)

    const res = await app.request('/chats', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await res.json() as { chat: { id: string; directory: string }; sessionId: string }
    expect(body.chat.id).toMatch(/^\d{8}-\d{6}-[0-9a-f]{6}$/)
    expect(body.sessionId).toBe('ses_created')
    expect(existsSync(body.chat.directory)).toBe(true)
    expect(session.create).toHaveBeenCalledWith({ location: { directory: body.chat.directory } })
  })

  it('deletes a chat session and reports the folder outcome', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    const directory = path.join(root, id)
    mkdirSync(directory)
    const { app, session } = createApp(root)
    session.get.mockResolvedValueOnce({ id: 'ses_1', location: { directory } })

    const res = await app.request(`/chats/${id}/sessions/ses_1`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ deleted: true, folderRemoved: true })
    expect(existsSync(directory)).toBe(false)
  })

  it('returns 400 for a session in another folder and 404 for an unknown chat', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    mkdirSync(path.join(root, id))
    const { app } = createApp(root)

    const mismatch = await app.request(`/chats/${id}/sessions/ses_1`, { method: 'DELETE' })
    expect(mismatch.status).toBe(400)

    const unknown = await app.request('/chats/20260203-040506-aaaaaa/sessions/ses_1', { method: 'DELETE' })
    expect(unknown.status).toBe(404)

    const malformed = await app.request('/chats/../../etc/sessions/ses_1', { method: 'DELETE' })
    expect(malformed.status).toBe(404)
  })
})
