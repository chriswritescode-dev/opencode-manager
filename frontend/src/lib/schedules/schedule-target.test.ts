import { describe, it, expect } from 'vitest'
import {
  isAssistantRepoId,
  scheduleTargetFromRepo,
  scheduleTargetFromAssistant,
} from './schedule-target'
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

describe('scheduleTargetFromRepo', () => {
  it('returns correct schedule target for a repo', () => {
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

    const target = scheduleTargetFromRepo(repo)

    expect(target).toEqual({
      repoId: 5,
      kind: 'repo',
      name: 'y',
      subtitle: 'y',
      fullPath: '/abs/y',
      backHref: '/repos/5',
    })
  })
})

describe('scheduleTargetFromAssistant', () => {
  it('returns correct schedule target for assistant', () => {
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

    const target = scheduleTargetFromAssistant(status)

    expect(target).toEqual({
      repoId: 0,
      kind: 'assistant',
      name: 'Assistant',
      subtitle: 'Built-in assistant',
      fullPath: '/abs/assistant',
      backHref: '/assistant',
    })
  })
})
