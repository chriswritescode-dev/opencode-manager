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
  } as unknown as SessionTransferData
}

function userWithFile(uri: string): SessionMessageInfo {
  return {
    id: 'msg_user',
    time: { created: 1 },
    type: 'user',
    text: 'hi',
    files: [{ data: '', mime: 'image/png', source: { type: 'uri', uri } }],
  } as unknown as SessionMessageInfo
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
  } as unknown as SessionMessageInfo
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

    const files = (result.messages[0] as unknown as { files: { source: { uri: string } }[] }).files
    expect(files[0]!.source.uri).toBe('/workspace/repos/repo/src/img.png')
  })

  it('rewrites an assistant tool file uri under the local root', () => {
    const result = rewriteTransferForRemote(makeTransfer([assistantWithToolFile('/Users/x/repo/out.png')]), ctx)

    const content = (result.messages[0] as unknown as { content: { state: { content: { uri: string }[] } }[] }).content
    expect(content[0]!.state.content[0]!.uri).toBe('/workspace/repos/repo/out.png')
  })

  it('leaves uris outside the local root untouched', () => {
    const result = rewriteTransferForRemote(makeTransfer([userWithFile('/elsewhere/img.png')]), ctx)

    const files = (result.messages[0] as unknown as { files: { source: { uri: string } }[] }).files
    expect(files[0]!.source.uri).toBe('/elsewhere/img.png')
  })

  it('rewrites a file:// user attachment uri under the local root, preserving encoding', () => {
    const result = rewriteTransferForRemote(makeTransfer([userWithFile('file:///Users/x/repo/a%20b.png')]), ctx)

    const files = (result.messages[0] as unknown as { files: { source: { uri: string } }[] }).files
    expect(files[0]!.source.uri).toBe('file:///workspace/repos/repo/a%20b.png')
  })

  it('rewrites a file:// assistant tool file uri under the local root', () => {
    const result = rewriteTransferForRemote(makeTransfer([assistantWithToolFile('file:///Users/x/repo/out.png')]), ctx)

    const content = (result.messages[0] as unknown as { content: { state: { content: { uri: string }[] } }[] }).content
    expect(content[0]!.state.content[0]!.uri).toBe('file:///workspace/repos/repo/out.png')
  })

  it('preserves file:// query and hash when relocating', () => {
    const result = rewriteTransferForRemote(makeTransfer([userWithFile('file:///Users/x/repo/a.png?v=1#frag')]), ctx)

    const files = (result.messages[0] as unknown as { files: { source: { uri: string } }[] }).files
    expect(files[0]!.source.uri).toBe('file:///workspace/repos/repo/a.png?v=1#frag')
  })

  it('leaves a file:// uri outside the local root untouched', () => {
    const uri = 'file:///elsewhere/img.png'
    const result = rewriteTransferForRemote(makeTransfer([userWithFile(uri)]), ctx)

    const files = (result.messages[0] as unknown as { files: { source: { uri: string } }[] }).files
    expect(files[0]!.source.uri).toBe(uri)
  })

  it('does not relocate a file:// uri that only shares a prefix with the local root', () => {
    const uri = 'file:///Users/x/repo-other/img.png'
    const result = rewriteTransferForRemote(makeTransfer([userWithFile(uri)]), ctx)

    const files = (result.messages[0] as unknown as { files: { source: { uri: string } }[] }).files
    expect(files[0]!.source.uri).toBe(uri)
  })

  it('leaves data uris and external http urls untouched', () => {
    const dataUri = 'data:image/png;base64,AAAA'
    const httpUri = 'https://example.com/img.png'
    const result = rewriteTransferForRemote(makeTransfer([userWithFile(dataUri), userWithFile(httpUri)]), ctx)

    const dataFiles = (result.messages[0] as unknown as { files: { source: { uri: string } }[] }).files
    const httpFiles = (result.messages[1] as unknown as { files: { source: { uri: string } }[] }).files
    expect(dataFiles[0]!.source.uri).toBe(dataUri)
    expect(httpFiles[0]!.source.uri).toBe(httpUri)
  })

  it('does not mutate a file:// input transfer', () => {
    const input = makeTransfer([userWithFile('file:///Users/x/repo/a%20b.png')])
    const frozen = structuredClone(input)

    rewriteTransferForRemote(input, ctx)

    expect(input).toEqual(frozen)
  })

  it('does not mutate the input transfer', () => {
    const input = makeTransfer([userWithFile('/Users/x/repo/src/img.png')])
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
      exportSession: vi.fn().mockResolvedValue(data),
      importSession: vi.fn().mockImplementation(async (directory: string, transferred: SessionTransferData) => {
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
    const files = (importCalls[0]!.data.messages[0] as unknown as { files: { source: { uri: string } }[] }).files
    expect(files[0]!.source.uri).toBe('/workspace/repos/repo/src/img.png')
    expect(progress).toEqual([[0, 1], [1, 1]])
  })

  it('returns the imported session id rather than the local one', async () => {
    const deps: TransferDeps = {
      exportSession: vi.fn().mockResolvedValue(makeTransfer()),
      importSession: vi.fn().mockResolvedValue({ sessionID: 'ses_remote' }),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'moved', sessionID: 'ses_remote', importedMessages: 0 })
  })

  it('reports an export failure without importing', async () => {
    const deps: TransferDeps = {
      exportSession: vi.fn().mockRejectedValue(new Error('export failed')),
      importSession: vi.fn(),
    }

    const result = await transferSession(input, deps)

    expect(result).toEqual({ kind: 'import-failed', message: 'export failed' })
    expect(deps.importSession).not.toHaveBeenCalled()
  })

  it('reports an import failure', async () => {
    const deps: TransferDeps = {
      exportSession: vi.fn().mockResolvedValue(makeTransfer()),
      importSession: vi.fn().mockRejectedValue(new Error('import diverged')),
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
