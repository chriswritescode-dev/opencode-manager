import { describe, expect, it, vi } from 'vitest'
import type { FileDiffInfo, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { readSessionChanges } from '../../src/services/session-changes'

function userMessage(id: string): SessionMessageInfo {
  return { id, type: 'user', time: { created: 0 }, text: id } as SessionMessageInfo
}

interface FakeClientOptions {
  asc?: SessionMessageInfo[]
  desc?: SessionMessageInfo[]
  diff?: FileDiffInfo[] | Error
}

function createFakeClient(options: FakeClientOptions = {}) {
  const list = vi.fn(async (input: { order?: 'asc' | 'desc' }) => ({
    data: input.order === 'asc' ? (options.asc ?? []) : (options.desc ?? []),
    cursor: {},
  }))
  const diff = vi.fn(async () => {
    if (options.diff instanceof Error) {
      throw options.diff
    }
    return options.diff ?? []
  })

  const client = {
    api: { message: { list }, session: { diff } },
    forwardRaw: vi.fn(),
  } as unknown as OpenCodeClient

  return { client, list, diff }
}

describe('readSessionChanges', () => {
  it('diffs from the first to the last user message with the context window', async () => {
    const changes: FileDiffInfo[] = [
      { file: 'src/a.ts', patch: '@@ -1 +1 @@', additions: 1, deletions: 1, status: 'modified' },
    ]
    const { client, diff } = createFakeClient({
      asc: [userMessage('msg-first')],
      desc: [userMessage('msg-last')],
      diff: changes,
    })

    await expect(readSessionChanges(client, 'ses-1')).resolves.toEqual(changes)
    expect(diff).toHaveBeenCalledWith({
      sessionID: 'ses-1',
      from: 'msg-first',
      to: 'msg-last',
      context: 3,
    })
  })

  it('looks up the first and last user messages with limit one in both orders', async () => {
    const { client, list } = createFakeClient({
      asc: [userMessage('msg-first')],
      desc: [userMessage('msg-last')],
    })

    await readSessionChanges(client, 'ses-1')

    expect(list).toHaveBeenCalledWith({ sessionID: 'ses-1', type: 'user', order: 'asc', limit: 1 })
    expect(list).toHaveBeenCalledWith({ sessionID: 'ses-1', type: 'user', order: 'desc', limit: 1 })
  })

  it('returns an empty list without diffing when the session has no user messages', async () => {
    const { client, diff } = createFakeClient({ asc: [], desc: [] })

    await expect(readSessionChanges(client, 'ses-1')).resolves.toEqual([])
    expect(diff).not.toHaveBeenCalled()
  })

  it('returns an empty list without diffing when only the last lookup is empty', async () => {
    const { client, diff } = createFakeClient({ asc: [userMessage('msg-first')], desc: [] })

    await expect(readSessionChanges(client, 'ses-1')).resolves.toEqual([])
    expect(diff).not.toHaveBeenCalled()
  })

  it('propagates OpenCode diff errors unchanged', async () => {
    const error = Object.assign(new Error('turn range invalid'), { _tag: 'TurnRangeError' })
    const { client } = createFakeClient({
      asc: [userMessage('msg-first')],
      desc: [userMessage('msg-last')],
      diff: error,
    })

    await expect(readSessionChanges(client, 'ses-1')).rejects.toBe(error)
  })
})
