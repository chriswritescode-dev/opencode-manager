import { describe, it, expect } from 'vitest'
import type { SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { readShowArtifactCall } from './artifactTool'

const ocmPart = (
  params: unknown,
  options: { status?: 'running' | 'completed'; metadata?: { path: string } } = {},
): SessionMessageAssistantTool => ({
  type: 'tool',
  id: 't1',
  name: 'ocm',
  time: { created: 1 },
  state:
    options.status === 'running'
      ? {
          status: 'running',
          input: { action: 'show_artifact', params },
          metadata: {},
        }
      : {
          status: 'completed',
          input: { action: 'show_artifact', params },
          content: [{ type: 'text', text: 'Artifact shown.' }],
          metadata: options.metadata,
        },
})

describe('readShowArtifactCall', () => {
  it('returns the validated title and path without a resolved path', () => {
    expect(readShowArtifactCall(ocmPart({ title: 'Report', path: 'reports/summary.html' }))).toEqual({
      title: 'Report',
      path: 'reports/summary.html',
      resolvedPath: undefined,
    })
  })

  it('returns the backend-resolved absolute path when metadata carries one', () => {
    expect(
      readShowArtifactCall(
        ocmPart(
          { title: 'Report', path: 'reports/summary.html' },
          { metadata: { path: '/workspace/sessions/ses_1/report.html' } },
        ),
      ),
    ).toEqual({
      title: 'Report',
      path: 'reports/summary.html',
      resolvedPath: '/workspace/sessions/ses_1/report.html',
    })
  })

  it('ignores an empty metadata path', () => {
    expect(
      readShowArtifactCall(ocmPart({ title: 'Report', path: 'a.html' }, { metadata: { path: '' } }))?.resolvedPath,
    ).toBeUndefined()
  })

  it('returns undefined for params that do not validate', () => {
    expect(readShowArtifactCall(ocmPart({ title: 'No path' }))).toBeUndefined()
    expect(readShowArtifactCall(ocmPart('not-an-object'))).toBeUndefined()
  })

  it('returns undefined for an unfinished call', () => {
    expect(readShowArtifactCall(ocmPart({ title: 'Report', path: 'a.html' }, { status: 'running' }))).toBeUndefined()
  })

  it('returns undefined for another action', () => {
    const part: SessionMessageAssistantTool = {
      type: 'tool',
      id: 't1',
      name: 'ocm',
      time: { created: 1 },
      state: {
        status: 'completed',
        input: { action: 'open_walkthrough', params: { title: 'Report', path: 'a.html' } },
        content: [{ type: 'text', text: 'Opened.' }],
      },
    }
    expect(readShowArtifactCall(part)).toBeUndefined()
  })
})
