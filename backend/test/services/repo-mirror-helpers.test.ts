import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getRepoById = vi.fn()
const createRepo = vi.fn()
const mockGetRepoByLocalPath = vi.fn()
const mockGetRepoByUrlAndBranch = vi.fn()

vi.mock('../../src/db/queries', () => ({
  getRepoById,
  createRepo,
  getRepoByLocalPath: mockGetRepoByLocalPath,
  getRepoBySourcePath: vi.fn(),
  updateRepoStatus: vi.fn(),
  updateRepoBranch: vi.fn(),
  deleteRepo: vi.fn(),
  getRepoByUrlAndBranch: mockGetRepoByUrlAndBranch,
}))

const mockGetActiveDirectories = vi.fn().mockReturnValue([])
vi.mock('../../src/services/sse-aggregator', () => ({
  sseAggregator: {
    getActiveDirectories: mockGetActiveDirectories,
  },
}))

let tmpRoot: string

vi.mock('@opencode-manager/shared/config/env', () => ({
  getReposPath: () => tmpRoot,
  getWorkspacePath: vi.fn(() => '/tmp/fake-workspace'),
}))

describe('ensureMirrorTargetPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tmpRoot = path.join(os.tmpdir(), `mirror-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpRoot, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('returns a path under the repos root', async () => {
    const { ensureMirrorTargetPath } = await import('../../src/services/repo')
    const result = ensureMirrorTargetPath('demo')

    expect(result.localPath).toBe('demo')
    expect(result.fullPath).toBe(path.join(tmpRoot, 'demo'))
  })

  it('appends -2 when the target directory already exists on disk', async () => {
    const { ensureMirrorTargetPath } = await import('../../src/services/repo')

    const result1 = ensureMirrorTargetPath('demo')
    expect(result1.localPath).toBe('demo')

    fs.mkdirSync(result1.fullPath, { recursive: true })

    const result2 = ensureMirrorTargetPath('demo')
    expect(result2.localPath).toBe('demo-2')
    expect(result2.fullPath).toBe(path.join(tmpRoot, 'demo-2'))
  })

  it('continues incrementing suffix on successive collisions', async () => {
    const { ensureMirrorTargetPath } = await import('../../src/services/repo')

    fs.mkdirSync(path.join(tmpRoot, 'demo'), { recursive: true })
    fs.mkdirSync(path.join(tmpRoot, 'demo-2'), { recursive: true })
    fs.mkdirSync(path.join(tmpRoot, 'demo-3'), { recursive: true })

    const result = ensureMirrorTargetPath('demo')
    expect(result.localPath).toBe('demo-4')
    expect(result.fullPath).toBe(path.join(tmpRoot, 'demo-4'))
  })

  it('slugifies names with special characters', async () => {
    const { ensureMirrorTargetPath } = await import('../../src/services/repo')
    const result = ensureMirrorTargetPath('My Repo Name!')

    expect(result.localPath).toBe('my-repo-name')
    expect(result.fullPath).toBe(path.join(tmpRoot, 'my-repo-name'))
  })

  it('falls back to "repo" when slugification produces empty string', async () => {
    const { ensureMirrorTargetPath } = await import('../../src/services/repo')
    const result = ensureMirrorTargetPath('!!!')

    expect(result.localPath).toBe('repo')
    expect(result.fullPath).toBe(path.join(tmpRoot, 'repo'))
  })
})

describe('createRepoRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tmpRoot = path.join(os.tmpdir(), `mirror-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpRoot, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('creates a repo row with cloneStatus ready and isLocal true when no originUrl', async () => {
    const database = {} as never
    const fakeRepo = {
      id: 1,
      localPath: 'demo',
      fullPath: path.join(tmpRoot, 'demo'),
      branch: undefined,
      defaultBranch: 'main',
      cloneStatus: 'ready' as const,
      clonedAt: Date.now(),
      isLocal: true,
    }
    createRepo.mockReturnValue(fakeRepo)

    const { createRepoRow } = await import('../../src/services/repo')
    const result = createRepoRow(database, {
      name: 'demo',
      localPath: 'demo',
      fullPath: path.join(tmpRoot, 'demo'),
    })

    expect(createRepo).toHaveBeenCalledWith(database, expect.objectContaining({
      cloneStatus: 'ready',
      isLocal: true,
    }))
    expect(result.repo.cloneStatus).toBe('ready')
    expect(result.created).toBe(true)
  })

  it('creates a repo row with isLocal false when originUrl is provided', async () => {
    const database = {} as never
    const fakeRepo = {
      id: 2,
      localPath: 'demo',
      fullPath: path.join(tmpRoot, 'demo'),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready' as const,
      clonedAt: Date.now(),
      isLocal: false,
    }
    createRepo.mockReturnValue(fakeRepo)

    const { createRepoRow } = await import('../../src/services/repo')
    const result = createRepoRow(database, {
      name: 'demo',
      originUrl: 'https://github.com/example/repo.git',
      localPath: 'demo',
      fullPath: path.join(tmpRoot, 'demo'),
      branch: 'main',
    })

    expect(createRepo).toHaveBeenCalledWith(database, expect.objectContaining({
      repoUrl: 'https://github.com/example/repo.git',
      cloneStatus: 'ready',
      isLocal: false,
    }))
    expect(result.repo.cloneStatus).toBe('ready')
    expect(result.created).toBe(true)
  })

  it('uses supplied branch as defaultBranch fallback', async () => {
    const database = {} as never
    createRepo.mockReturnValue({ id: 3 })

    const { createRepoRow } = await import('../../src/services/repo')
    createRepoRow(database, {
      name: 'demo',
      localPath: 'demo',
      fullPath: path.join(tmpRoot, 'demo'),
      branch: 'develop',
    })

    expect(createRepo).toHaveBeenCalledWith(database, expect.objectContaining({
      defaultBranch: 'develop',
      branch: 'develop',
    }))
  })

  it('returns existing repo with created false when originUrl matches existing row', async () => {
    const database = {} as never
    const existingRepo = {
      id: 5,
      localPath: 'existing-repo',
      fullPath: path.join(tmpRoot, 'existing-repo'),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready' as const,
      clonedAt: Date.now(),
      isLocal: false,
    }

    mockGetRepoByUrlAndBranch.mockReturnValue(existingRepo)

    const { createRepoRow } = await import('../../src/services/repo')
    const result = createRepoRow(database, {
      name: 'new-name',
      originUrl: 'https://github.com/example/repo.git',
      localPath: 'new-name',
      fullPath: path.join(tmpRoot, 'new-name'),
      branch: 'main',
    })

    expect(mockGetRepoByUrlAndBranch).toHaveBeenCalledWith(database, 'https://github.com/example/repo.git', 'main')
    expect(createRepo).not.toHaveBeenCalled()
    expect(result.repo).toEqual(existingRepo)
    expect(result.created).toBe(false)
  })

  it('returns existing repo with created false when localPath matches existing row', async () => {
    const database = {} as never
    const existingRepo = {
      id: 6,
      localPath: 'existing-repo',
      fullPath: path.join(tmpRoot, 'existing-repo'),
      branch: undefined,
      defaultBranch: 'main',
      cloneStatus: 'ready' as const,
      clonedAt: Date.now(),
      isLocal: true,
    }

    mockGetRepoByLocalPath.mockReturnValue(existingRepo)

    const { createRepoRow } = await import('../../src/services/repo')
    const result = createRepoRow(database, {
      name: 'new-name',
      localPath: 'existing-repo',
      fullPath: path.join(tmpRoot, 'existing-repo'),
    })

    expect(mockGetRepoByLocalPath).toHaveBeenCalledWith(database, 'existing-repo')
    expect(createRepo).not.toHaveBeenCalled()
    expect(result.repo).toEqual(existingRepo)
    expect(result.created).toBe(false)
  })
})

describe('isRepoInUse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tmpRoot = path.join(os.tmpdir(), `mirror-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmpRoot, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('returns false when repo does not exist in DB', async () => {
    getRepoById.mockReturnValue(null)
    mockGetActiveDirectories.mockReturnValue([])

    const { isRepoInUse } = await import('../../src/services/repo')
    const result = isRepoInUse({} as never, 999)

    expect(result).toBe(false)
  })

  it('returns false when no active sessions match repo fullPath', async () => {
    getRepoById.mockReturnValue({
      id: 1,
      fullPath: path.join(tmpRoot, 'demo'),
      localPath: 'demo',
    })
    mockGetActiveDirectories.mockReturnValue([path.join(tmpRoot, 'other')])

    const { isRepoInUse } = await import('../../src/services/repo')
    const result = isRepoInUse({} as never, 1)

    expect(result).toBe(false)
  })

  it('returns true when active session matches repo fullPath', async () => {
    getRepoById.mockReturnValue({
      id: 1,
      fullPath: path.join(tmpRoot, 'demo'),
      localPath: 'demo',
    })
    mockGetActiveDirectories.mockReturnValue([path.join(tmpRoot, 'demo')])

    const { isRepoInUse } = await import('../../src/services/repo')
    const result = isRepoInUse({} as never, 1)

    expect(result).toBe(true)
  })
})
