import path from 'path'
import { randomBytes } from 'crypto'
import fs from 'fs/promises'
import { getChatsPath, getReposPath } from '@opencode-manager/shared/config/env'
import { parseOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import {
  ChatIdSchema,
  parseChatIdCreatedAt,
  type Chat,
  type CreateChatRequest,
  type DeleteChatSessionResponse,
  type ListChatsQuery,
  type ListChatsResponse,
} from '@opencode-manager/shared/schemas'
import type { OpenCodeClient } from './opencode/client'
import { ensureDirectoryExists } from './file-operations'
import { canonicalPathSync } from '../utils/fs-safe'

const CHAT_ID_ATTEMPTS = 5

export class ChatNotFoundError extends Error {
  constructor(chatId: string) {
    super(`Chat not found: ${chatId}`)
    this.name = 'ChatNotFoundError'
  }
}

export class ChatSessionMismatchError extends Error {
  constructor(sessionId: string, chatId: string) {
    super(`Session ${sessionId} does not belong to chat ${chatId}`)
    this.name = 'ChatSessionMismatchError'
  }
}

function formatChatTimestamp(now: Date): string {
  const iso = now.toISOString()
  return [
    iso.slice(0, 4),
    iso.slice(5, 7),
    iso.slice(8, 10),
    '-',
    iso.slice(11, 13),
    iso.slice(14, 16),
    iso.slice(17, 19),
  ].join('')
}

/** Owns the lifecycle of chat folders and the OpenCode sessions created inside them. */
export class ChatService {
  constructor(
    private readonly openCodeClient: OpenCodeClient,
    private readonly root: () => string = getChatsPath,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list({ limit, cursor }: ListChatsQuery): Promise<ListChatsResponse> {
    const chatIds = await this.listChatIds()
    const ordered = cursor ? chatIds.filter((id) => id < cursor) : chatIds
    const page = ordered.slice(0, limit)
    const nextCursor = ordered.length > limit ? page[page.length - 1] : undefined

    return {
      chats: page.map((id) => this.toChat(id)),
      ...(nextCursor ? { nextCursor } : {}),
    }
  }

  async resolve(chatId: string): Promise<Chat | null> {
    if (!ChatIdSchema.safeParse(chatId).success) return null

    try {
      const stats = await fs.stat(path.join(this.root(), chatId))
      return stats.isDirectory() ? this.toChat(chatId) : null
    } catch {
      return null
    }
  }

  async findByDirectory(directory: string): Promise<Chat | null> {
    const target = canonicalPathSync(path.resolve(directory))
    for (const id of await this.listChatIds()) {
      const chat = this.toChat(id)
      if (canonicalPathSync(chat.directory) === target) return chat
    }
    return null
  }

  async create(input: CreateChatRequest): Promise<{ chat: Chat; sessionId: string }> {
    const root = this.root()
    await ensureDirectoryExists(root)

    const { id, directory } = await this.createFolder(root)
    try {
      const model = input.model ? parseOpenCodeModelRef(input.model) : undefined
      const session = await this.openCodeClient.api.session.create({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
        ...(model ? { model } : {}),
        location: { directory },
      })
      return { chat: this.toChat(id), sessionId: session.id }
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async deleteSession(chatId: string, sessionId: string): Promise<DeleteChatSessionResponse> {
    const chat = await this.resolve(chatId)
    if (!chat) throw new ChatNotFoundError(chatId)

    const session = await this.openCodeClient.api.session.get({ sessionID: sessionId })
    const sessionDirectory = canonicalPathSync(path.resolve(session.location.directory))
    if (sessionDirectory !== canonicalPathSync(chat.directory)) {
      throw new ChatSessionMismatchError(sessionId, chatId)
    }

    await this.openCodeClient.api.session.remove({ sessionID: sessionId })
    const remaining = await this.openCodeClient.api.session.list({
      directory: chat.directory,
      limit: 1,
    })

    const folderRemoved = remaining.data.length === 0
    if (folderRemoved) {
      await fs.rm(chat.directory, { recursive: true, force: true })
    }

    return { deleted: true, folderRemoved }
  }

  private async listChatIds(): Promise<string[]> {
    const root = this.root()
    await ensureDirectoryExists(root)
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && ChatIdSchema.safeParse(entry.name).success)
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  }

  private async createFolder(root: string): Promise<{ id: string; directory: string }> {
    for (let attempt = 0; attempt < CHAT_ID_ATTEMPTS; attempt++) {
      const id = `${formatChatTimestamp(this.now())}-${randomBytes(3).toString('hex')}`
      const directory = path.join(root, id)
      try {
        await fs.mkdir(directory)
        return { id, directory }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new Error('Failed to allocate a unique chat folder')
  }

  private toChat(id: string): Chat {
    const directory = path.join(this.root(), id)
    return {
      id,
      directory,
      filesPath: path.relative(getReposPath(), directory),
      createdAt: parseChatIdCreatedAt(id),
    }
  }
}
