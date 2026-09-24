import { describe, it, expect, vi } from 'vitest'
import { getMessagesContentVersion } from '../sessionContentVersion'
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from '@opencode-manager/shared/opencode'

const makeAssistant = (
  content: SessionMessageAssistant['content'],
  extra: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant => ({
  id: 'msg-1',
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'p', id: 'm' },
  time: { created: 1000, completed: 2000 },
  content,
  ...extra,
})

const makeUser = (text: string): SessionMessageInfo => ({
  id: 'msg-1',
  type: 'user',
  text,
  time: { created: 1000 },
})

const makeTool = (state: SessionMessageAssistantTool['state']): SessionMessageAssistantTool => ({
  type: 'tool',
  id: 'p1',
  name: 'read',
  state,
  time: { created: 1000 },
})

describe('getMessagesContentVersion', () => {
  it('returns 0 for undefined', () => {
    expect(getMessagesContentVersion(undefined)).toBe(0)
  })

  it('returns 0 for empty array', () => {
    expect(getMessagesContentVersion([])).toBe(0)
  })

  it('is stable across two calls with the same input', () => {
    const msgs = [makeAssistant([{ type: 'text', text: 'hello' }])]
    const v1 = getMessagesContentVersion(msgs)
    const v2 = getMessagesContentVersion(msgs)
    expect(v1).toBe(v2)
  })

  it('changes when a text part text is extended', () => {
    const v1 = getMessagesContentVersion([makeAssistant([{ type: 'text', text: 'hello' }])])
    const v2 = getMessagesContentVersion([makeAssistant([{ type: 'text', text: 'hello world' }])])

    expect(v2).not.toBe(v1)
  })

  it('changes when a tool part output changes', () => {
    const v1 = getMessagesContentVersion([
      makeAssistant([
        makeTool({ status: 'completed', input: {}, content: [{ type: 'text', text: 'foo' }], metadata: {} }),
      ]),
    ])

    const v2 = getMessagesContentVersion([
      makeAssistant([
        makeTool({ status: 'completed', input: {}, content: [{ type: 'text', text: 'foobar' }], metadata: {} }),
      ]),
    ])

    expect(v2).not.toBe(v1)
  })

  it('changes when a tool part status transitions', () => {
    const vStreaming = getMessagesContentVersion([
      makeAssistant([makeTool({ status: 'streaming', input: '{"path"' })]),
    ])

    const vRunning = getMessagesContentVersion([
      makeAssistant([makeTool({ status: 'running', input: {}, metadata: {} })]),
    ])

    expect(vRunning).not.toBe(vStreaming)
  })

  it('changes when a tool part has an error', () => {
    const vOk = getMessagesContentVersion([
      makeAssistant([
        makeTool({ status: 'completed', input: {}, content: [{ type: 'text', text: '' }], metadata: {} }),
      ]),
    ])

    const vError = getMessagesContentVersion([
      makeAssistant([
        makeTool({
          status: 'error',
          input: {},
          error: { type: 'tool.failed', message: 'Failed to read' },
          metadata: {},
        }),
      ]),
    ])

    expect(vError).not.toBe(vOk)
  })

  it('accounts for reasoning part text length', () => {
    const msgs = [makeAssistant([{ type: 'reasoning', text: 'thinking...' }])]
    expect(getMessagesContentVersion(msgs)).toBeGreaterThan(0)
  })

  it('changes when tool status transitions between same-length strings', () => {
    const vRunning = getMessagesContentVersion([
      makeAssistant([makeTool({ status: 'running', input: {}, metadata: {} })]),
    ])

    const vError = getMessagesContentVersion([
      makeAssistant([
        makeTool({
          status: 'error',
          input: {},
          error: { type: 'tool.failed', message: 'failed' },
          metadata: {},
        }),
      ]),
    ])

    expect(vError).not.toBe(vRunning)
  })

  it('changes when tool output changes to different text of the same length', () => {
    const vFoo = getMessagesContentVersion([
      makeAssistant([
        makeTool({ status: 'completed', input: {}, content: [{ type: 'text', text: 'foo' }], metadata: {} }),
      ]),
    ])

    const vBar = getMessagesContentVersion([
      makeAssistant([
        makeTool({ status: 'completed', input: {}, content: [{ type: 'text', text: 'bar' }], metadata: {} }),
      ]),
    ])

    expect(vBar).not.toBe(vFoo)
  })

  it('accounts for user message text', () => {
    const v1 = getMessagesContentVersion([makeUser('hello')])
    const v2 = getMessagesContentVersion([makeUser('hello world')])

    expect(v2).not.toBe(v1)
  })

  it('does not recompute an unchanged message object', () => {
    const message = makeAssistant([{ type: 'text', text: 'hello' }])
    const content = message.content
    let contentReads = 0
    Object.defineProperty(message, 'content', {
      get: () => {
        contentReads += 1
        return content
      },
    })

    const v1 = getMessagesContentVersion([message])
    const v2 = getMessagesContentVersion([message, makeUser('next')])
    const v3 = getMessagesContentVersion([message])

    expect(contentReads).toBe(1)
    expect(v3).toBe(v1)
    expect(v2).not.toBe(v1)
  })

  it('does not stringify tool metadata containing large diffs', () => {
    const stringify = vi.spyOn(JSON, 'stringify')
    const largePatch = '+'.repeat(200_000)

    getMessagesContentVersion([
      makeAssistant([
        makeTool({
          status: 'completed',
          input: {},
          content: [{ type: 'text', text: 'done' }],
          metadata: { files: [{ file: '/repo/a.ts', patch: largePatch, additions: 1, deletions: 0 }] },
        }),
      ]),
    ])

    expect(stringify).not.toHaveBeenCalled()
    stringify.mockRestore()
  })

  it('changes when tool metadata gains files', () => {
    const file = { file: '/repo/a.ts', patch: '+a', additions: 1, deletions: 0 }
    const v1 = getMessagesContentVersion([
      makeAssistant([
        makeTool({ status: 'completed', input: {}, content: [], metadata: { files: [file] } }),
      ]),
    ])
    const v2 = getMessagesContentVersion([
      makeAssistant([
        makeTool({ status: 'completed', input: {}, content: [], metadata: { files: [file, file] } }),
      ]),
    ])

    expect(v2).not.toBe(v1)
  })

  it('changes when running tool metadata output grows', () => {
    const v1 = getMessagesContentVersion([
      makeAssistant([makeTool({ status: 'running', input: {}, metadata: { output: 'line 1' } })]),
    ])
    const v2 = getMessagesContentVersion([
      makeAssistant([makeTool({ status: 'running', input: {}, metadata: { output: 'line 1\nline 2' } })]),
    ])

    expect(v2).not.toBe(v1)
  })

  it('changes when the step snapshot records changed files', () => {
    const base = makeAssistant([{ type: 'text', text: 'done' }])
    const withFiles = makeAssistant([{ type: 'text', text: 'done' }], {
      snapshot: { files: ['/repo/a.ts', '/repo/b.ts'] },
    })

    expect(getMessagesContentVersion([withFiles])).not.toBe(getMessagesContentVersion([base]))
  })
})
