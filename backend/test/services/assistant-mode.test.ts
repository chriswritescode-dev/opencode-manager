import { describe, expect, it, beforeEach, vi } from 'vitest'
import path from 'path'
import type { Repo } from '@opencode-manager/shared/types'
import {
  ensureAssistantMode,
  getAssistantModeStatus,
  getAssistantModeDirectory,
  buildAssistantOpenCodeConfig,
} from '../../src/services/assistant-mode'
import { OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import { getReposPath } from '@opencode-manager/shared/config/env'

const mockRepo: Repo = {
  id: 1,
  repoUrl: 'https://github.com/example/test-repo.git',
  localPath: 'test-repo',
  fullPath: '/tmp/test-repo',
  sourcePath: '/tmp/test-repo/.git',
  branch: 'main',
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: Date.now(),
  lastPulled: Date.now(),
  lastAccessedAt: Date.now(),
  openCodeConfigName: 'default',
  isWorktree: false,
  isLocal: false,
}

const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
}))

const { writeFile, mkdir, access, readFile } = fsMocks

vi.mock('fs/promises', () => ({
  default: {
    writeFile: fsMocks.writeFile,
    readFile: fsMocks.readFile,
    mkdir: fsMocks.mkdir,
    access: fsMocks.access,
    stat: fsMocks.stat,
  },
}))

vi.mock('fs', () => ({
  promises: {
    writeFile: fsMocks.writeFile,
    readFile: fsMocks.readFile,
    mkdir: fsMocks.mkdir,
    access: fsMocks.access,
    stat: fsMocks.stat,
  },
}))

describe('getAssistantModeDirectory', () => {
  it('returns the shared assistant path within repos root', () => {
    const result = getAssistantModeDirectory()
    expect(result).toBe(path.join(getReposPath(), 'assistant'))
  })

  it('resolves path correctly', () => {
    const result = getAssistantModeDirectory()
    expect(result).toContain(path.join('repos', 'assistant'))
  })
})

describe('buildAssistantOpenCodeConfig', () => {
  it('returns valid OpenCode config', () => {
    const config = buildAssistantOpenCodeConfig()
    const result = OpenCodeConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  it('includes instructions for AGENTS.md', () => {
    const config = buildAssistantOpenCodeConfig()
    expect(config.instructions).toEqual(['AGENTS.md'])
  })

  it('has permission rules for the assistant workspace', () => {
    const config = buildAssistantOpenCodeConfig()
    expect(config.permission).toEqual({
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      bash: 'allow',
      external_directory: 'ask',
    })
  })
})

describe('ensureAssistantMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readFile.mockResolvedValue(JSON.stringify(buildAssistantOpenCodeConfig()))
  })

  it('creates the shared assistant workspace and files when missing', async () => {
    access.mockRejectedValue(new Error('File not found'))

    const result = await ensureAssistantMode(mockRepo)

    expect(result.directory).toBe(path.join(getReposPath(), 'assistant'))
    expect(result.relativePath).toBe('repos/assistant')
    expect(result.files.agentsMd.exists).toBe(true)
    expect(result.files.opencodeJson.exists).toBe(true)
  })

  it('does not overwrite existing customized files by default', async () => {
    access.mockResolvedValue(undefined)
    mkdir.mockResolvedValue(undefined)
    writeFile.mockResolvedValue(undefined)

    const result = await ensureAssistantMode(mockRepo)

    expect(result.files.agentsMd.exists).toBe(true)
    expect(result.files.agentsMd.created).toBe(false)
    expect(result.files.opencodeJson.exists).toBe(true)
    expect(result.files.opencodeJson.created).toBe(false)

    expect(writeFile).not.toHaveBeenCalled()
  })

  it('overwrites only files whose overwrite option is true', async () => {
    access.mockResolvedValue(undefined)

    const result = await ensureAssistantMode(mockRepo, {
      overwriteAgentsMd: true,
      overwriteOpenCodeConfig: true,
    })

    expect(result.files.agentsMd.created).toBe(true)
    expect(result.files.opencodeJson.created).toBe(true)
  })

  it('overwrites legacy invalid assistant opencode config', async () => {
    access.mockResolvedValue(undefined)
    readFile.mockResolvedValue(JSON.stringify({
      instructions: ['AGENTS.md'],
      permission: {
        allow: ['**/*'],
        ask: ['../**/*'],
      },
    }))

    const result = await ensureAssistantMode(mockRepo)

    expect(result.files.opencodeJson.created).toBe(true)
    const content = writeFile.mock.calls[0]?.[1]
    expect(Buffer.isBuffer(content)).toBe(true)
    expect((content as Buffer).toString('utf8')).toContain('external_directory')
  })

  it('returns a directory under the repos root', async () => {
    access.mockRejectedValue(new Error('File not found'))
    mkdir.mockResolvedValue(undefined)
    writeFile.mockResolvedValue(undefined)

    const result = await ensureAssistantMode(mockRepo)

    expect(result.directory).toBe(path.join(getReposPath(), 'assistant'))
    expect(result.directory.startsWith(getReposPath())).toBe(true)
  })
})

describe('getAssistantModeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports existence for folder files', async () => {
    access
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)

    const result = await getAssistantModeStatus(mockRepo)

    expect(result.repoId).toBe(mockRepo.id)
    expect(result.relativePath).toBe('repos/assistant')
    expect(result.files.agentsMd.exists).toBe(true)
    expect(result.files.opencodeJson.exists).toBe(true)
  })
})
