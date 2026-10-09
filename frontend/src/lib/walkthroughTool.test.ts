import { describe, it, expect } from 'vitest'
import type { SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { readOpenWalkthroughCall } from './walkthroughTool'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const ocmPart = (
  params: Json,
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
          input: { action: 'open_walkthrough', params },
          content: [{ type: 'text', text: 'Opened the walkthrough.' }],
        }
      : {
          status: 'running',
          input: { action: 'open_walkthrough', params },
          metadata: {},
        },
})

describe('readOpenWalkthroughCall', () => {
  it('returns the validated source the agent requested', () => {
    expect(readOpenWalkthroughCall(ocmPart({ source: { kind: 'staged' } }))).toEqual({
      id: 't1',
      source: { kind: 'staged' },
    })
  })

  it('returns the source with its base for git-backed sources', () => {
    expect(readOpenWalkthroughCall(ocmPart({ source: { kind: 'branch', base: 'develop' } }))).toEqual({
      id: 't1',
      source: { kind: 'branch', base: 'develop' },
    })
  })

  it('returns no source when the agent omitted one', () => {
    expect(readOpenWalkthroughCall(ocmPart({}))).toEqual({ id: 't1', source: undefined })
  })

  it('ignores a source that does not validate', () => {
    expect(readOpenWalkthroughCall(ocmPart({ source: { kind: 'nonsense' } }))).toEqual({
      id: 't1',
      source: undefined,
    })
  })

  it('ignores malformed params', () => {
    expect(readOpenWalkthroughCall(ocmPart('not-an-object'))).toEqual({ id: 't1', source: undefined })
    expect(readOpenWalkthroughCall(ocmPart(null))).toEqual({ id: 't1', source: undefined })
  })

  it('returns undefined for an unfinished call', () => {
    expect(readOpenWalkthroughCall(ocmPart({ source: { kind: 'staged' } }, 'running'))).toBeUndefined()
  })
})
