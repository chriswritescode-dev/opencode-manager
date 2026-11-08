import { describe, it, expect } from 'vitest'
import type { SessionMessageAssistant, SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { collectOpenOutputCalls, readOpenOutputCall } from './outputTool'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const ocmPart = (
  params: Json,
  options: { action?: string; name?: string; status?: 'running' | 'completed' } = {},
): SessionMessageAssistantTool => {
  const input = { action: options.action ?? 'open_output', params }
  return {
    type: 'tool',
    id: 't1',
    name: options.name ?? 'ocm',
    time: { created: 1 },
    state:
      (options.status ?? 'completed') === 'completed'
        ? {
            status: 'completed',
            input,
            content: [{ type: 'text', text: 'Opened the output.' }],
          }
        : {
            status: 'running',
            input,
            metadata: {},
          },
  }
}

const legacyPart = (
  input: Record<string, Json>,
  status: 'running' | 'completed' = 'completed',
): SessionMessageAssistantTool => ({
  type: 'tool',
  id: 't1',
  name: 'ocm',
  time: { created: 1 },
  state:
    status === 'completed'
      ? {
          status: 'completed',
          input: { action: 'open_walkthrough', params: input },
          content: [{ type: 'text', text: 'Opened the walkthrough.' }],
        }
      : {
          status: 'running',
          input: { action: 'open_walkthrough', params: input },
          metadata: {},
        },
})

const assistantMessage = (
  id: string,
  content: SessionMessageAssistant['content'],
): SessionMessageAssistant => ({
  id,
  type: 'assistant',
  agent: 'assistant',
  model: { id: 'model', providerID: 'provider' },
  time: { created: 1 },
  content,
})

describe('readOpenOutputCall', () => {
  it('returns the definition id and params the agent requested', () => {
    expect(
      readOpenOutputCall(ocmPart({ definitionId: 'walkthrough', params: { source: { kind: 'staged' } } })),
    ).toEqual({
      id: 't1',
      definitionId: 'walkthrough',
      params: { source: { kind: 'staged' } },
    })
  })

  it('returns no params when the agent omitted them', () => {
    expect(readOpenOutputCall(ocmPart({ definitionId: 'walkthrough' }))).toEqual({
      id: 't1',
      definitionId: 'walkthrough',
      params: undefined,
    })
  })

  it('returns undefined for a definition id that does not validate', () => {
    expect(readOpenOutputCall(ocmPart({ definitionId: 'Not Valid!' }))).toBeUndefined()
    expect(readOpenOutputCall(ocmPart({ definitionId: '' }))).toBeUndefined()
  })

  it('returns undefined for malformed params', () => {
    expect(readOpenOutputCall(ocmPart('not-an-object'))).toBeUndefined()
    expect(readOpenOutputCall(ocmPart(null))).toBeUndefined()
  })

  it('ignores nested params that do not validate', () => {
    expect(
      readOpenOutputCall(ocmPart({ definitionId: 'walkthrough', params: 'not-an-object' })),
    ).toEqual({
      id: 't1',
      definitionId: 'walkthrough',
      params: undefined,
    })
  })

  it('returns undefined for an unfinished call', () => {
    expect(
      readOpenOutputCall(ocmPart({ definitionId: 'walkthrough' }, { status: 'running' })),
    ).toBeUndefined()
  })

  it('reads a publish_output call with a definition id and params', () => {
    expect(
      readOpenOutputCall(
        ocmPart(
          { definitionId: 'walkthrough', params: { source: { kind: 'branch', base: 'develop' } } },
          { action: 'publish_output' },
        ),
      ),
    ).toEqual({
      id: 't1',
      definitionId: 'walkthrough',
      params: { source: { kind: 'branch', base: 'develop' } },
    })
  })

  it('returns undefined for publish_output without a definition id', () => {
    expect(readOpenOutputCall(ocmPart({ data: { title: 'Report' } }, { action: 'publish_output' }))).toBeUndefined()
  })

  it('returns undefined for a non-ocm tool', () => {
    expect(
      readOpenOutputCall(ocmPart({ definitionId: 'walkthrough' }, { name: 'read' })),
    ).toBeUndefined()
  })

  it('returns undefined for another ocm action', () => {
    expect(
      readOpenOutputCall(ocmPart({ definitionId: 'walkthrough' }, { action: 'show_artifact' })),
    ).toBeUndefined()
  })

  it('maps a legacy open_walkthrough call to the walkthrough definition with its source', () => {
    const part = legacyPart({ source: { kind: 'staged' } })

    expect(readOpenOutputCall(part)).toEqual({
      id: 't1',
      definitionId: 'walkthrough',
      params: { source: { kind: 'staged' } },
    })
  })

  it('maps a legacy open_walkthrough call without a source to the walkthrough definition', () => {
    const part = legacyPart({})

    expect(readOpenOutputCall(part)).toEqual({
      id: 't1',
      definitionId: 'walkthrough',
      params: undefined,
    })
  })

  it('drops an invalid legacy open_walkthrough source', () => {
    const part = legacyPart({ source: { kind: 'unknown' } })

    expect(readOpenOutputCall(part)).toEqual({
      id: 't1',
      definitionId: 'walkthrough',
      params: undefined,
    })
  })

  it('ignores an unfinished legacy open_walkthrough call', () => {
    const part = legacyPart({ source: { kind: 'session' } }, 'running')

    expect(readOpenOutputCall(part)).toBeUndefined()
  })
})

describe('collectOpenOutputCalls', () => {
  it('collects open-output calls in message order and ignores other parts', () => {
    const first = ocmPart({ definitionId: 'walkthrough' })
    const second = { ...ocmPart({ definitionId: 'review' }), id: 't2' }
    const other = { ...ocmPart({ definitionId: 'walkthrough' }, { action: 'show_artifact' }), id: 't3' }

    expect(
      collectOpenOutputCalls([
        assistantMessage('m1', [first, { type: 'text', text: 'Done.' }]),
        assistantMessage('m2', [other, second]),
      ]),
    ).toEqual([
      { id: 't1', definitionId: 'walkthrough', params: undefined },
      { id: 't2', definitionId: 'review', params: undefined },
    ])
  })
})
