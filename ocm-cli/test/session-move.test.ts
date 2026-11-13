import { describe, it, expect, vi } from 'vitest'
import { rewriteTransferForRemote, transferSession, moveReminderText, type TransferDeps } from '../src/session-move.js'
import type { SessionMessageInfo, SessionTransferData } from '@opencode-manager/shared/opencode'

const ctx = { localRoot: '/Users/x/repo', remoteRoot: '/workspace/repos/repo' }

function makeTransfer(messages: SessionMessageInfo[] = [], directory = '/Users/x/repo'): SessionTransferData {
  return {
    info: {
      id: 'ses_a',
      projectID: 'proj_1',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory },
    },
    messages,
  }
}

function userWithFile(uri: string): SessionMessageInfo {
  return {
    id: 'msg_user',
    time: { created: 1 },
    type: 'user',
    text: 'hi',
    files: [{ data: '', mime: 'image/png', source: { type: 'uri', uri } }],
  }
}

function assistantWithToolFile(uri: string): SessionMessageInfo {
  return {
    id: 'msg_assistant',
    time: { created: 2 },
    type: 'assistant',
    agent: 'code',
    model: { id: 'm', providerID: 'p' },
    content: [
      {
        type: 'tool',
        id: 'tool_1',
        name: 'read',
        state: { status: 'completed', input: {}, content: [{ type: 'file', uri, mime: 'image/png' }] },
        time: { created: 2 },
      },
    ],
  }
}

function userFileUri(transfer: SessionTransferData, index = 0): string | null {
  const message = transfer.messages[index]
  if (message?.type !== 'user') return null
  const source = message.files?.[0]?.source
  return source?.type === 'uri' ? source.uri : null
}

function assistantFileUri(transfer: SessionTransferData, index = 0): string | null {
  const message = transfer.messages[index]
  if (message?.type !== 'assistant') return null
  const part = message.content[0]
  if (part?.type !== 'tool') return null
  if (part.state.status !== 'completed') return null
  const file = part.state.content[0]
  return file.type === 'file' ? file.uri : null
}

describe('rewriteTransferForRemote', () => {
  it('rewrites info.location.directory to the remote root', () => {
    const result = rewriteTransferForRemote(makeTransfer(), ctx)

    expect(result.info.location.directory).toBe('/workspace/repos/repo')
  })

  it('preserves subdirectories under the repo root', () => {
    const result = rewriteTransferForRemote(makeTransfer([], '/Users/x/repo/packages/app'), ctx)

    expect(result.info.location.directory).toBe('/workspace/repos/repo/packages/app')
  })

  it('rewrites a user file attachment uri under the local root', () => {
    const result = rewriteTransferForRemote(makeTransfer([userWithFile('/Users/x/repo/src/img.png')]), ctx)

    expect(userFileUri(result)).toBe('/workspace/repos/repo/src/img.png')
  })

  it('rewrites an assistant tool file uri under the local root', () => {
    const result = rewriteTransferForRemote(makeTransfer([assistantWithToolFile('/Users/x/repo/out.png')]), ctx)

    expect(assistantFileUri(result)).toBe('/workspace/repos/repo/out.png')
  })

  it('leaves uris outside the local root untouched', () => {
    const result = rewriteTransferForRemote(makeTransfer([userWithFile('/elsewhere/img.png')]), ctx)

    expect(userFileUri(result)).toBe('/elsewhere/img.png')
  })

  it('rewrites a file:// user attachment uri under the local root, preserving encoding', () => {
    const result = rewriteTransferForRemote(makeTransfer([userWithFile('file:///Users/x/repo/a%20b.png')]), ctx)

    expect(userFileUri(result)).toBe('file:///workspace/repos/repo/a%20b.png')
  })

  it('rewrites a file:// assistant tool file uri under the local root', () => {
    const result = rewriteTransferForRemote(makeTransfer([assistantWithToolFile('file:///Users/x/repo/out.png')]), ctx)

    expect(assistantFileUri(result)).toBe('file:///workspace/repos/repo/out.png')
  })

  it('preserves file:// query and hash when relocating', () => {
    const result = rewriteTransferForRemote(makeTransfer([userWithFile('file:///Users/x/repo/a.png?v=1#frag')]), ctx)

    expect(userFileUri(result)).toBe('file:///workspace/repos/repo/a.png?v=1#frag')
  })

  it('leaves a file:// uri outside the local root untouched', () => {
    const uri = 'file:///elsewhere/img.png'
    const result = rewriteTransferForRemote(makeTransfer([userWithFile(uri)]), ctx)

    expect(userFileUri(result)).toBe(uri)
  })

  it('does not relocate a file:// uri that only shares a prefix with the local root', () => {
    const uri = 'file:///Users/x/repo-other/img.png'
    const result = rewriteTransferForRemote(makeTransfer([userWithFile(uri)]), ctx)

    expect(userFileUri(result)).toBe(uri)
  })

  it('leaves data uris and external http urls untouched', () => {
    const dataUri = 'data:image/png;base64,AAAA'
    const httpUri = 'https://example.com/img.png'
    const result = rewriteTransferForRemote(makeTransfer([userWithFile(dataUri), userWithFile(httpUri)]), ctx)

    expect(userFileUri(result, 0)).toBe(dataUri)
    expect(userFileUri(result, 1)).toBe(httpUri)
  })

  it.each([
    ['file://', 'file:///Users/x/repo/a%20b.png'],
    ['path', '/Users/x/repo/src/img.png'],
  ])('does not mutate a %s input transfer', (_label, uri) => {
    const input = makeTransfer([userWithFile(uri)])
    const frozen = structuredClone(input)

    rewriteTransferForRemote(input, ctx)

    expect(input).toEqual(frozen)
  })
})

describe('transferSession', () => {
  const input = { sessionID: 'ses_a', localRoot: '/Users/x/repo', remoteDirectory: '/workspace/repos/repo' }

  it('exports, imports the rewritten transfer, and reports progress', async () => {
    const data = makeTransfer([userWithFile('/Users/x/repo/src/img.png')])
    const importCalls: { directory: string; data: SessionTransferData }[] = []
    const progress: [number, number][] = []

    const deps: TransferDeps = {
      exportSession: vi.fn<TransferDeps['exportSession']>().mockResolvedValue(data),
      importSession: vi.fn<TransferDeps['importSession']>().mockImplementation(async (directory, transferred) => {
        importCalls.push({ directory, data: transferred })
        return { sessionID: 'ses_a' }
      }),
      onProgress: (transferred, total) => progress.push([transferred, total]),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'moved', sessionID: 'ses_a', importedMessages: 1 })
    expect(deps.exportSession).toHaveBeenCalledWith('ses_a')
    expect(importCalls).toHaveLength(1)
    expect(importCalls[0]!.directory).toBe('/workspace/repos/repo')
    expect(importCalls[0]!.data.info.location.directory).toBe('/workspace/repos/repo')
    expect(userFileUri(importCalls[0]!.data)).toBe('/workspace/repos/repo/src/img.png')
    expect(progress).toEqual([[0, 1], [1, 1]])
  })

  it('returns the imported session id rather than the local one', async () => {
    const deps: TransferDeps = {
      exportSession: vi.fn<TransferDeps['exportSession']>().mockResolvedValue(makeTransfer()),
      importSession: vi.fn<TransferDeps['importSession']>().mockResolvedValue({ sessionID: 'ses_remote' }),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'moved', sessionID: 'ses_remote', importedMessages: 0 })
  })

  it('reports an export failure without importing', async () => {
    const deps: TransferDeps = {
      exportSession: vi.fn<TransferDeps['exportSession']>().mockRejectedValue(new Error('export failed')),
      importSession: vi.fn<TransferDeps['importSession']>(),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'import-failed', message: 'export failed' })
    expect(deps.importSession).not.toHaveBeenCalled()
  })

  it('reports an import failure', async () => {
    const deps: TransferDeps = {
      exportSession: vi.fn<TransferDeps['exportSession']>().mockResolvedValue(makeTransfer()),
      importSession: vi.fn<TransferDeps['importSession']>().mockRejectedValue(new Error('import diverged')),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'import-failed', message: 'import diverged' })
  })
})

describe('moveReminderText', () => {
  it('wraps the directory in a system-reminder block', () => {
    const result = moveReminderText('/workspace/repos/repo')
    expect(result).toContain('<system-reminder>')
    expect(result).toContain('</system-reminder>')
    expect(result).toContain('/workspace/repos/repo')
  })

  it('matches the native opencode wording byte-for-byte apart from the directory', () => {
    const dir = '/some/path'
    const result = moveReminderText(dir)
    const prefix = '<system-reminder>The user has changed the current working directory to "'
    expect(result.startsWith(prefix)).toBe(true)
    expect(result).toBe(
      `<system-reminder>The user has changed the current working directory to "${dir}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`,
    )
  })
})
