import { describe, it, expect } from 'vitest'
import {
  isAssistantRepoId,
  workspaceFromRepo,
  workspaceFromAssistant,
} from './workspace'
import type { AssistantModeStatus } from '@opencode-manager/shared/types'

describe('isAssistantRepoId', () => {
  it('returns true for repoId 0', () => {
    expect(isAssistantRepoId(0)).toBe(true)
  })

  it('returns false for positive repoId', () => {
    expect(isAssistantRepoId(5)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isAssistantRepoId(undefined)).toBe(false)
  })
})

describe('workspaceFromRepo', () => {
  it('returns correct workspace for a repo', () => {
    const repo = {
      id: 5,
      repoUrl: 'https://x/y',
      localPath: 'y',
      fullPath: '/abs/y',
      sourcePath: undefined,
      defaultBranch: 'main',
      cloneStatus: 'ready' as const,
      clonedAt: 0,
    }

    const workspace = workspaceFromRepo(repo)

    expect(workspace).toEqual({
      repoId: 5,
      kind: 'repo',
      name: 'y',
      subtitle: 'y',
      fullPath: '/abs/y',
      backHref: '/repos/5',
    })
  })
})

describe('workspaceFromAssistant', () => {
  it('returns correct workspace for assistant', () => {
    const status: AssistantModeStatus = {
      repoId: 0,
      directory: '/abs/assistant',
      relativePath: 'repos/assistant',
      files: {
        agentsMd: { path: '', exists: false, created: false },
        opencodeJson: { path: '', exists: false, created: false },
      },
      schedulesSkill: { path: '', exists: false, created: false },
    }

    const workspace = workspaceFromAssistant(status)

    expect(workspace).toEqual({
      repoId: 0,
      kind: 'assistant',
      name: 'Assistant',
      subtitle: 'Assistant Workspace',
      fullPath: '/abs/assistant',
      backHref: '/assistant',
    })
  })
})
