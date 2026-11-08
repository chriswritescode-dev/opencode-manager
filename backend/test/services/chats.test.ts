import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { ChatNotFoundError, ChatService, ChatSessionMismatchError } from '../../src/services/chats'

const CHAT_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/

interface FakeClient {
  client: OpenCodeClient
  session: {
    create: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
  }
}

interface FakeTerminals {
  terminals: { removeAll: ReturnType<typeof vi.fn> }
}

function createFakeClient(): FakeClient {
  const session = {
    create: vi.fn(async () => ({ id: 'ses_new' })),
    get: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
      id: sessionID,
      location: { directory: '/tmp/other-chat' },
    })),
    remove: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ data: [], cursor: {} })),
  }
  return { client: { api: { session } } as unknown as OpenCodeClient, session }
}

function createFakeTerminals(): FakeTerminals {
  return { terminals: { removeAll: vi.fn(async () => undefined) } }
}

function createChatFolder(root: string, id: string): string {
  const directory = path.join(root, id)
  mkdirSync(directory, { recursive: true })
  return directory
}

const roots: string[] = []

function createRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'chats-service-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true })
  }
})

describe('ChatService', () => {
  it('creates a chat folder matching the id format and leaves it empty', async () => {
    const root = createRoot()
    const fake = createFakeClient()
    const { terminals } = createFakeTerminals()
    const service = new ChatService(
      fake.client,
      terminals,
      () => root,
      () => new Date('2026-01-02T03:04:05Z'),
    )

    const result = await service.create({ title: 'Hello' })

    expect(result.sessionId).toBe('ses_new')
    expect(result.chat.id).toMatch(CHAT_ID_PATTERN)
    expect(result.chat.id.startsWith('20260102-030405-')).toBe(true)
    expect(result.chat.directory).toBe(path.join(root, result.chat.id))
    expect(result.chat.createdAt).toBe(Date.UTC(2026, 0, 2, 3, 4, 5))
    expect(readdirSync(result.chat.directory)).toEqual([])
    expect(fake.session.create).toHaveBeenCalledWith({
      title: 'Hello',
      location: { directory: result.chat.directory },
    })
  })

  it('removes the new folder when session creation fails', async () => {
    const root = createRoot()
    const fake = createFakeClient()
    fake.session.create.mockRejectedValueOnce(new Error('session failed'))
    const service = new ChatService(fake.client, createFakeTerminals().terminals, () => root)

    await expect(service.create({})).rejects.toThrow('session failed')
    expect(readdirSync(root)).toEqual([])
  })

  it('lists chats newest first, pages with a cursor, and ignores non-chat entries', async () => {
    const root = createRoot()
    const ids = ['20260101-000000-aaaaaa', '20260102-000000-bbbbbb', '20260103-000000-cccccc']
    for (const id of ids) createChatFolder(root, id)
    createChatFolder(root, 'not-a-chat')
    mkdirSync(path.join(root, '.hidden'))
    const service = new ChatService(
      createFakeClient().client,
      createFakeTerminals().terminals,
      () => root,
    )

    const first = await service.list({ limit: 2 })
    expect(first.chats.map((chat) => chat.id)).toEqual([ids[2], ids[1]])
    expect(first.nextCursor).toBe(ids[1])

    const second = await service.list({ limit: 2, cursor: first.nextCursor })
    expect(second.chats.map((chat) => chat.id)).toEqual([ids[0]])
    expect(second.nextCursor).toBeUndefined()

    const last = await service.list({ limit: 2, cursor: ids[0] })
    expect(last.chats).toEqual([])
    expect(last.nextCursor).toBeUndefined()
  })

  it('resolves only existing chat folders and rejects malformed ids', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    createChatFolder(root, id)
    const service = new ChatService(
      createFakeClient().client,
      createFakeTerminals().terminals,
      () => root,
    )

    expect((await service.resolve(id))?.id).toBe(id)
    expect(await service.resolve('20260203-040506-aaaaaa')).toBeNull()
    expect(await service.resolve('../../etc')).toBeNull()
    expect(await service.resolve('not-a-chat')).toBeNull()
  })

  it('finds a chat by its canonical directory', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    const directory = createChatFolder(root, id)
    const service = new ChatService(
      createFakeClient().client,
      createFakeTerminals().terminals,
      () => root,
    )

    expect((await service.findByDirectory(directory))?.id).toBe(id)
    expect(await service.findByDirectory(path.join(root, 'missing'))).toBeNull()
  })

  it('returns null for paths that are not an existing chat folder directly under the root', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    const directory = createChatFolder(root, id)
    createChatFolder(root, 'not-a-chat')
    const service = new ChatService(
      createFakeClient().client,
      createFakeTerminals().terminals,
      () => root,
    )

    expect(await service.findByDirectory(path.join(directory, 'nested'))).toBeNull()
    expect((await service.findByDirectory(directory + path.sep))?.id).toBe(id)
    expect(await service.findByDirectory(root)).toBeNull()
    expect(await service.findByDirectory(path.join(root, 'not-a-chat'))).toBeNull()
    expect(await service.findByDirectory(path.join(root, '..', 'elsewhere'))).toBeNull()
    expect(await service.findByDirectory('/unrelated/path')).toBeNull()
  })

  it('keeps the folder when another session remains after a delete', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    const directory = createChatFolder(root, id)
    const fake = createFakeClient()
    const { terminals } = createFakeTerminals()
    fake.session.get.mockResolvedValueOnce({ id: 'ses_1', location: { directory } })
    fake.session.list.mockResolvedValueOnce({ data: [{ id: 'ses_fork' }], cursor: {} })
    const service = new ChatService(fake.client, terminals, () => root)

    const result = await service.deleteSession(id, 'ses_1')

    expect(result).toEqual({ deleted: true, folderRemoved: false })
    expect(fake.session.remove).toHaveBeenCalledWith({ sessionID: 'ses_1' })
    expect(fake.session.list).toHaveBeenCalledWith({ directory, limit: 1 })
    expect(terminals.removeAll).not.toHaveBeenCalled()
    expect(existsSync(directory)).toBe(true)
  })

  it('removes terminals before the folder when no session remains after a delete', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    const directory = createChatFolder(root, id)
    const fake = createFakeClient()
    const { terminals } = createFakeTerminals()
    let folderExistedDuringRemoval = false
    terminals.removeAll.mockImplementationOnce(async (target: string) => {
      folderExistedDuringRemoval = target === directory && existsSync(directory)
    })
    fake.session.get.mockResolvedValueOnce({ id: 'ses_1', location: { directory } })
    const service = new ChatService(fake.client, terminals, () => root)

    const result = await service.deleteSession(id, 'ses_1')

    expect(result).toEqual({ deleted: true, folderRemoved: true })
    expect(terminals.removeAll).toHaveBeenCalledWith(directory)
    expect(folderExistedDuringRemoval).toBe(true)
    expect(existsSync(directory)).toBe(false)
  })

  it('removes the folder even when terminal cleanup fails', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    const directory = createChatFolder(root, id)
    const fake = createFakeClient()
    const { terminals } = createFakeTerminals()
    terminals.removeAll.mockRejectedValueOnce(new Error('terminal cleanup failed'))
    fake.session.get.mockResolvedValueOnce({ id: 'ses_1', location: { directory } })
    const service = new ChatService(fake.client, terminals, () => root)

    const result = await service.deleteSession(id, 'ses_1')

    expect(result).toEqual({ deleted: true, folderRemoved: true })
    expect(existsSync(directory)).toBe(false)
  })

  it('reports folderRemoved false without throwing when the remaining-session list fails', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    const directory = createChatFolder(root, id)
    const fake = createFakeClient()
    const { terminals } = createFakeTerminals()
    fake.session.get.mockResolvedValueOnce({ id: 'ses_1', location: { directory } })
    fake.session.list.mockRejectedValueOnce(new Error('list failed'))
    const service = new ChatService(fake.client, terminals, () => root)

    const result = await service.deleteSession(id, 'ses_1')

    expect(result).toEqual({ deleted: true, folderRemoved: false })
    expect(fake.session.remove).toHaveBeenCalledWith({ sessionID: 'ses_1' })
    expect(terminals.removeAll).not.toHaveBeenCalled()
    expect(existsSync(directory)).toBe(true)
  })

  it('rejects a session that belongs to another folder', async () => {
    const root = createRoot()
    const id = '20260203-040506-abcdef'
    createChatFolder(root, id)
    const fake = createFakeClient()
    fake.session.get.mockResolvedValueOnce({ id: 'ses_1', location: { directory: '/tmp/other-chat' } })
    const service = new ChatService(fake.client, createFakeTerminals().terminals, () => root)

    await expect(service.deleteSession(id, 'ses_1')).rejects.toBeInstanceOf(ChatSessionMismatchError)
    expect(fake.session.remove).not.toHaveBeenCalled()
  })

  it('rejects an unknown chat id before touching sessions', async () => {
    const fake = createFakeClient()
    const service = new ChatService(fake.client, createFakeTerminals().terminals, () => createRoot())

    await expect(service.deleteSession('20260203-040506-abcdef', 'ses_1')).rejects.toBeInstanceOf(ChatNotFoundError)
    await expect(service.deleteSession('../escape', 'ses_1')).rejects.toBeInstanceOf(ChatNotFoundError)
    expect(fake.session.get).not.toHaveBeenCalled()
  })
})
