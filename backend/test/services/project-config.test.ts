import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { createRepo, setRepoSetting } from '../../src/db/queries'
import { createGitService } from '../../src/services/git/GitService'
import { ProjectConfigService, ProjectConfigError } from '../../src/services/project-config'
import type { GitAuthService } from '../../src/services/git-auth'
import type { CreateTerminalInput, TerminalService } from '../../src/services/terminal'
import { formatTerminalTitle } from '@opencode-manager/shared/utils'
import type { ProjectAction } from '@opencode-manager/shared/schemas'
import type { Repo, TerminalInfo } from '@opencode-manager/shared/types'

const gitAuthService = { getGitEnvironment: () => ({}) } as unknown as GitAuthService

function createService(db: Database): ProjectConfigService {
  return new ProjectConfigService(db, createGitService(gitAuthService), gitAuthService)
}

function createAction(overrides: Partial<ProjectAction> = {}): ProjectAction {
  return { id: 'serve', name: 'Serve', command: 'pnpm dev', autoOpenUrl: false, ...overrides }
}

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

function createStatefulTerminalService(gate: { promise: Promise<void> } | null) {
  const terminals: TerminalInfo[] = []
  let created = 0
  const list = vi.fn(async (target: string) => terminals.filter((terminal) => terminal.cwd === target))
  const create = vi.fn(async (target: string, input: CreateTerminalInput): Promise<TerminalInfo> => {
    if (gate) {
      await gate.promise
    }
    created += 1
    const terminal: TerminalInfo = {
      id: `pty-${created}`,
      title: formatTerminalTitle({ kind: input.kind, name: input.name, actionId: input.actionId }),
      kind: input.kind,
      ...(input.actionId ? { actionId: input.actionId } : {}),
      cwd: target,
      status: 'running',
    }
    terminals.push(terminal)
    return terminal
  })
  return { service: { list, create } as unknown as TerminalService, list, create, terminals }
}

describe('ProjectConfigService personal settings', () => {
  let db: Database
  let service: ProjectConfigService
  let repo: Repo

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    service = createService(db)
    repo = createRepo(db, { localPath: 'repo-a', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now(), isLocal: true })
  })

  afterEach(() => {
    db.close()
  })

  it('round-trips personal actions', () => {
    const actions = [createAction(), createAction({ id: 'test', name: 'Test', command: 'pnpm test' })]

    service.setPersonalActions(repo, actions)

    expect(service.getPersonalActions(repo)).toEqual(actions)
  })

  it('returns personal actions through getConfig with the personal source', async () => {
    service.setPersonalActions(repo, [createAction()])

    const config = await service.getConfig(repo, repo.fullPath)

    expect(config.actions).toEqual([{ ...createAction(), source: 'personal' }])
    expect(config.repoFile).toEqual({
      path: '.ocm/project.json',
      exists: false,
      trusted: false,
      hash: null,
      executable: null,
      warnings: [],
    })
  })

  it('round-trips personal setup commands through getConfig', async () => {
    service.setPersonalSetup(repo, ['pnpm install', 'pnpm build'])

    expect(service.getPersonalSetup(repo)).toEqual(['pnpm install', 'pnpm build'])

    const config = await service.getConfig(repo, repo.fullPath)
    expect(config.worktreeSetup).toEqual([
      { command: 'pnpm install', source: 'personal' },
      { command: 'pnpm build', source: 'personal' },
    ])
  })

  it('rejects duplicate action ids', () => {
    let caught: unknown
    try {
      service.setPersonalActions(repo, [createAction(), createAction({ name: 'Other' })])
    } catch (error: unknown) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ProjectConfigError)
    expect((caught as ProjectConfigError).status).toBe(400)
    expect((caught as ProjectConfigError).message).toBe('Duplicate action id')
  })

  it('reads corrupt stored action JSON as an empty list', () => {
    setRepoSetting(db, repo.id, 'projectActions', '{not json')

    expect(service.getPersonalActions(repo)).toEqual([])
  })

  it('reads wrongly shaped stored action JSON as an empty list', () => {
    setRepoSetting(db, repo.id, 'projectActions', JSON.stringify({ id: 'serve' }))

    expect(service.getPersonalActions(repo)).toEqual([])
  })

  it('reads corrupt stored setup JSON as an empty list', () => {
    setRepoSetting(db, repo.id, 'worktreeSetupCommands', 'not-json')

    expect(service.getPersonalSetup(repo)).toEqual([])
  })
})

describe('ProjectConfigService worktree resolution', () => {
  let db: Database
  let service: ProjectConfigService
  let basePath: string
  let worktreePath: string
  let root: string
  let baseRepo: Repo
  let worktreeRepo: Repo

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-project-config-')))
    basePath = path.join(root, 'base')
    worktreePath = path.join(root, 'linked worktree')

    execSync(`git init "${basePath}"`)
    execSync(`git -C "${basePath}" config user.email test@test.com`)
    execSync(`git -C "${basePath}" config user.name Test`)
    execSync(`git -C "${basePath}" commit --allow-empty -m "Initial commit"`)
    execSync(`git -C "${basePath}" worktree add -b feature "${worktreePath}"`)
  })

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    service = createService(db)
    baseRepo = createRepo(db, {
      localPath: basePath,
      sourcePath: basePath,
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    })
    worktreeRepo = createRepo(db, {
      localPath: worktreePath,
      sourcePath: worktreePath,
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
      isWorktree: true,
    })
  })

  afterEach(() => {
    db.close()
  })

  it('resolves the main checkout from both the base and the linked worktree', async () => {
    const git = createGitService(gitAuthService)

    expect(fs.realpathSync(await git.getMainCheckoutPath(basePath))).toBe(fs.realpathSync(basePath))
    expect(fs.realpathSync(await git.getMainCheckoutPath(worktreePath))).toBe(fs.realpathSync(basePath))
  })

  it('resolves a linked worktree repo to the main checkout row', async () => {
    const resolved = await service.resolveProjectRepo(worktreeRepo)

    expect(resolved.id).toBe(baseRepo.id)
  })

  it('keeps a non-worktree repo unchanged', async () => {
    const resolved = await service.resolveProjectRepo(baseRepo)

    expect(resolved.id).toBe(baseRepo.id)
  })

  it('returns personal actions saved on the base repo when resolving from the worktree', async () => {
    service.setPersonalActions(baseRepo, [createAction()])

    const config = await service.getConfig(worktreeRepo, worktreePath)

    expect(config.actions).toEqual([{ ...createAction(), source: 'personal' }])
  })

  it('returns personal setup saved on the base repo when resolving from the worktree', async () => {
    service.setPersonalSetup(baseRepo, ['pnpm install'])

    const config = await service.getConfig(worktreeRepo, worktreePath)

    expect(config.worktreeSetup).toEqual([{ command: 'pnpm install', source: 'personal' }])
  })
})

describe('ProjectConfigService repository file', () => {
  let db: Database
  let service: ProjectConfigService
  let repo: Repo
  let directory: string

  function repoFilePath(): string {
    return path.join(directory, '.ocm', 'project.json')
  }

  function writeRepoFile(content: unknown): void {
    fs.mkdirSync(path.dirname(repoFilePath()), { recursive: true })
    fs.writeFileSync(repoFilePath(), typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    service = createService(db)
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-repo-file-'))
    repo = createRepo(db, {
      localPath: directory,
      sourcePath: directory,
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('reports an untrusted repository file with a hash and its items', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'repo-serve', name: 'Serve', command: 'pnpm dev' }] })

    const config = await service.getConfig(repo, directory)

    expect(config.repoFile.exists).toBe(true)
    expect(config.repoFile.trusted).toBe(false)
    expect(config.repoFile.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(config.actions).toEqual([
      { id: 'repo-serve', name: 'Serve', command: 'pnpm dev', autoOpenUrl: false, source: 'repo' },
    ])
  })

  it('rejects trusting a stale hash', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })

    await expect(service.trustRepoFile(repo, directory, 'a'.repeat(64))).rejects.toMatchObject({
      status: 409,
      code: 'REPO_CONFIG_CHANGED',
    })
  })

  it('drops trust when the name, command, or autoOpenUrl changes', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })
    const first = await service.getConfig(repo, directory)
    await service.trustRepoFile(repo, directory, first.repoFile.hash ?? '')
    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(true)

    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve renamed', command: 'pnpm dev' }] })
    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(false)

    const renamed = await service.getConfig(repo, directory)
    await service.trustRepoFile(repo, directory, renamed.repoFile.hash ?? '')
    writeRepoFile({
      version: 1,
      projectActions: [{ id: 'serve', name: 'Serve renamed', command: 'pnpm dev', autoOpenUrl: true }],
    })
    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(false)
  })

  it('changes the hash when only the name or autoOpenUrl changes', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })
    const base = await service.getConfig(repo, directory)

    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve renamed', command: 'pnpm dev' }] })
    const renamed = await service.getConfig(repo, directory)

    writeRepoFile({
      version: 1,
      projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev', autoOpenUrl: true }],
    })
    const autoOpen = await service.getConfig(repo, directory)

    expect(renamed.repoFile.hash).not.toBe(base.repoFile.hash)
    expect(autoOpen.repoFile.hash).not.toBe(base.repoFile.hash)
  })

  it('reports invalid JSON with an error and no repository items', async () => {
    writeRepoFile('{not json')

    const config = await service.getConfig(repo, directory)

    expect(config.repoFile.exists).toBe(true)
    expect(config.repoFile.error).toBe('Invalid JSON')
    expect(config.repoFile.hash).toBeNull()
    expect(config.actions).toEqual([])
  })

  it('reports a schema-invalid file with an error and no repository items', async () => {
    writeRepoFile({ version: 2 })

    const config = await service.getConfig(repo, directory)

    expect(config.repoFile.error).toContain('Does not match the project file schema')
    expect(config.actions).toEqual([])
  })

  it('rejects a repository action url that is not http(s)', async () => {
    writeRepoFile({
      version: 1,
      projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev', url: 'javascript:alert(1)' }],
    })

    const config = await service.getConfig(repo, directory)

    expect(config.repoFile.error).toContain('Does not match the project file schema')
    expect(config.repoFile.executable).toBeNull()
  })

  it('accepts an http url template', async () => {
    writeRepoFile({
      version: 1,
      projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev', url: 'http://localhost:3000/{branch}' }],
    })

    const config = await service.getConfig(repo, directory)

    expect(config.repoFile.executable?.actions[0]?.url).toBe('http://localhost:3000/{branch}')
  })

  it('reports a symlinked .ocm directory as invalid on read', async () => {
    const realDir = path.join(directory, 'real-ocm')
    fs.mkdirSync(realDir, { recursive: true })
    fs.writeFileSync(path.join(realDir, 'project.json'), JSON.stringify({ version: 1 }))
    fs.symlinkSync(realDir, path.join(directory, '.ocm'), 'dir')

    const config = await service.getConfig(repo, directory)

    expect(config.repoFile.error).toBe('.ocm/project.json must not be a symbolic link')
    expect(config.repoFile.hash).toBeNull()
    expect(config.repoFile.executable).toBeNull()
  })

  it('reports a symlinked project.json as invalid on read', async () => {
    const ocmDir = path.join(directory, '.ocm')
    fs.mkdirSync(ocmDir, { recursive: true })
    const target = path.join(directory, 'target.json')
    fs.writeFileSync(target, JSON.stringify({ version: 1 }))
    fs.symlinkSync(target, path.join(ocmDir, 'project.json'))

    const config = await service.getConfig(repo, directory)

    expect(config.repoFile.error).toBe('.ocm/project.json must not be a symbolic link')
  })

  it('refuses to move an action into a symlinked repository config', async () => {
    service.setPersonalActions(repo, [createAction()])
    const realDir = path.join(directory, 'real-ocm')
    fs.mkdirSync(realDir, { recursive: true })
    fs.writeFileSync(path.join(realDir, 'project.json'), JSON.stringify({ version: 1 }))
    fs.symlinkSync(realDir, path.join(directory, '.ocm'), 'dir')

    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })).rejects.toMatchObject({
      status: 400,
      code: 'REPO_CONFIG_SYMLINK',
    })
    expect(service.getPersonalActions(repo)).toEqual([createAction()])
  })

  it('moves an action personal to repo preserving unknown keys and marking it trusted', async () => {
    service.setPersonalActions(repo, [createAction()])
    writeRepoFile({ version: 1, customKey: 'keep-me' })

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })

    const raw = JSON.parse(fs.readFileSync(repoFilePath(), 'utf8')) as { customKey: string; projectActions: unknown[] }
    expect(raw.customKey).toBe('keep-me')
    expect(raw.projectActions).toEqual([createAction()])
    expect(service.getPersonalActions(repo)).toEqual([])

    const config = await service.getConfig(repo, directory)
    expect(config.repoFile.trusted).toBe(true)
    expect(config.actions).toEqual([{ ...createAction(), source: 'repo' }])
  })

  it('deletes the file and .ocm directory when the last item moves back', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })

    expect(fs.existsSync(repoFilePath())).toBe(false)
    expect(fs.existsSync(path.join(directory, '.ocm'))).toBe(false)
    expect(service.getPersonalActions(repo)).toEqual([createAction()])
  })

  it('keeps unrelated repository setup untrusted when moving an action to personal', async () => {
    writeRepoFile({
      version: 1,
      projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }],
      setupWorktree: ['echo unrelated'],
    })

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })

    const config = await service.getConfig(repo, directory)
    expect(config.repoFile.trusted).toBe(false)
    expect(config.actions).toEqual([{ ...createAction(), source: 'personal' }])

    const { service: terminalService, create } = createStatefulTerminalService(null)
    const result = await service.runWorktreeSetup(repo, directory, terminalService)
    expect(result).toEqual({ status: 'skipped', reason: 'untrusted' })
    expect(create).not.toHaveBeenCalled()
  })

  it('keeps unrelated repository actions untrusted when moving an action into the file', async () => {
    service.setPersonalActions(repo, [
      createAction({ id: 'personal-serve', name: 'Personal Serve', command: 'pnpm personal' }),
    ])
    writeRepoFile({
      version: 1,
      projectActions: [{ id: 'repo-other', name: 'Other', command: 'pnpm other' }],
    })

    await service.moveItem(repo, directory, { kind: 'action', id: 'personal-serve', to: 'repo' })

    const config = await service.getConfig(repo, directory)
    expect(config.repoFile.trusted).toBe(false)
    expect(config.actions).toEqual([
      { id: 'repo-other', name: 'Other', command: 'pnpm other', autoOpenUrl: false, source: 'repo' },
      { id: 'personal-serve', name: 'Personal Serve', command: 'pnpm personal', autoOpenUrl: false, source: 'repo' },
    ])

    const { service: terminalService } = createStatefulTerminalService(null)
    await expect(service.runAction(repo, directory, 'repo-other', terminalService)).rejects.toMatchObject({
      status: 409,
      code: 'REPO_CONFIG_UNTRUSTED',
    })
  })

  it('moves a setup command personal to repo and back', async () => {
    service.setPersonalSetup(repo, ['pnpm install'])

    await service.moveItem(repo, directory, { kind: 'setup', command: 'pnpm install', to: 'repo' })
    let config = await service.getConfig(repo, directory)
    expect(config.worktreeSetup).toEqual([{ command: 'pnpm install', source: 'repo' }])
    expect(config.repoFile.trusted).toBe(true)

    await service.moveItem(repo, directory, { kind: 'setup', command: 'pnpm install', to: 'personal' })
    config = await service.getConfig(repo, directory)
    expect(config.worktreeSetup).toEqual([{ command: 'pnpm install', source: 'personal' }])
    expect(config.repoFile.exists).toBe(false)
  })

  it('drops a colliding repository action and warns', async () => {
    service.setPersonalActions(repo, [createAction()])
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Repo Serve', command: 'pnpm repo-dev' }] })

    const config = await service.getConfig(repo, directory)

    expect(config.actions).toEqual([{ ...createAction(), source: 'personal' }])
    expect(config.repoFile.warnings).toHaveLength(1)
    expect(config.repoFile.warnings[0]).toContain('serve')
  })

  it('lists every executable repository action including a shadowed one', async () => {
    service.setPersonalActions(repo, [
      createAction({ id: 'serve', name: 'Personal Serve', command: 'pnpm personal' }),
    ])
    writeRepoFile({
      version: 1,
      projectActions: [
        { id: 'serve', name: 'Repo Serve', command: 'pnpm repo-dev', url: 'https://example.com', autoOpenUrl: true },
        { id: 'other', name: 'Other', command: 'pnpm other' },
      ],
      setupWorktree: ['pnpm install'],
    })

    const config = await service.getConfig(repo, directory)

    expect(config.repoFile.executable).toEqual({
      actions: [
        { id: 'serve', name: 'Repo Serve', command: 'pnpm repo-dev', url: 'https://example.com', autoOpenUrl: true },
        { id: 'other', name: 'Other', command: 'pnpm other', url: null, autoOpenUrl: false },
      ],
      setup: ['pnpm install'],
    })
    expect(config.actions).toEqual([
      { id: 'serve', name: 'Personal Serve', command: 'pnpm personal', autoOpenUrl: false, source: 'personal' },
      { id: 'other', name: 'Other', command: 'pnpm other', autoOpenUrl: false, source: 'repo' },
    ])
  })

  it('hashes a file without env exactly like the legacy executable shape', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })

    const config = await service.getConfig(repo, directory)
    const legacyHash = createHash('sha256')
      .update(
        JSON.stringify({
          actions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev', url: null, autoOpenUrl: false }],
          setup: [],
        }),
      )
      .digest('hex')

    expect(config.repoFile.hash).toBe(legacyHash)
  })

  it('changes the hash and drops trust when env is added or edited', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })
    const base = await service.getConfig(repo, directory)
    await service.trustRepoFile(repo, directory, base.repoFile.hash ?? '')
    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(true)

    writeRepoFile({
      version: 1,
      projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }],
      env: { TOKEN: '${{ secrets.TOKEN }}' },
    })
    const withEnv = await service.getConfig(repo, directory)
    expect(withEnv.repoFile.hash).not.toBe(base.repoFile.hash)
    expect(withEnv.repoFile.trusted).toBe(false)

    await service.trustRepoFile(repo, directory, withEnv.repoFile.hash ?? '')
    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(true)

    writeRepoFile({
      version: 1,
      projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }],
      env: { TOKEN: '${{ secrets.OTHER }}' },
    })
    const edited = await service.getConfig(repo, directory)
    expect(edited.repoFile.hash).not.toBe(withEnv.repoFile.hash)
    expect(edited.repoFile.trusted).toBe(false)
  })

  it('includes environment and env in the executable snapshot only when present', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })
    expect((await service.getConfig(repo, directory)).repoFile.executable).not.toHaveProperty('env')

    writeRepoFile({
      version: 1,
      projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }],
      environment: 'Prod',
      env: { TOKEN: '${{ secrets.TOKEN }}' },
    })
    const config = await service.getConfig(repo, directory)
    expect(config.repoFile.executable?.environment).toBe('prod')
    expect(config.repoFile.executable?.env).toEqual({ TOKEN: '${{ secrets.TOKEN }}' })
  })

  it('counts an untrusted env mapping as executable content when moving an action', async () => {
    service.setPersonalActions(repo, [createAction()])
    writeRepoFile({ version: 1, env: { TOKEN: '${{ secrets.TOKEN }}' } })

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })

    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(false)
  })

  it('counts an untrusted environment selector as executable content when moving an action', async () => {
    service.setPersonalActions(repo, [createAction()])
    writeRepoFile({ version: 1, environment: 'prod' })

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })

    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(false)
  })

  it('reports the first schema issue with its path and message', async () => {
    writeRepoFile({ version: 1, env: { TOKEN: '${{ github.sha }}' } })

    const config = await service.getConfig(repo, directory)

    expect(config.repoFile.error).toContain('Does not match the project file schema')
    expect(config.repoFile.error).toContain('env.TOKEN')
    expect(config.repoFile.error).toContain('Unsupported expression')
  })

  it('rejects moving an unknown personal action', async () => {
    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'missing', to: 'repo' })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('rejects moving an unknown repository action', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })

    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'missing', to: 'personal' })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('rejects moving a setup command into a repository already at capacity', async () => {
    const repoCommands = Array.from({ length: 20 }, (_, index) => `repo-${index}`)
    writeRepoFile({ version: 1, setupWorktree: repoCommands })
    const first = await service.getConfig(repo, directory)
    await service.trustRepoFile(repo, directory, first.repoFile.hash ?? '')
    const originalBytes = fs.readFileSync(repoFilePath(), 'utf8')
    service.setPersonalSetup(repo, ['personal-cmd'])

    await expect(
      service.moveItem(repo, directory, { kind: 'setup', command: 'personal-cmd', to: 'repo' }),
    ).rejects.toMatchObject({ status: 409, code: 'PROJECT_CONFIG_LIMIT_EXCEEDED' })

    expect(fs.readFileSync(repoFilePath(), 'utf8')).toBe(originalBytes)
    expect(service.getPersonalSetup(repo)).toEqual(['personal-cmd'])
    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(true)
  })

  it('rejects moving a setup command into personal storage already at capacity', async () => {
    const personalCommands = Array.from({ length: 20 }, (_, index) => `personal-${index}`)
    service.setPersonalSetup(repo, personalCommands)
    writeRepoFile({ version: 1, setupWorktree: ['repo-cmd'] })
    const first = await service.getConfig(repo, directory)
    await service.trustRepoFile(repo, directory, first.repoFile.hash ?? '')
    const originalBytes = fs.readFileSync(repoFilePath(), 'utf8')

    await expect(
      service.moveItem(repo, directory, { kind: 'setup', command: 'repo-cmd', to: 'personal' }),
    ).rejects.toMatchObject({ status: 409, code: 'PROJECT_CONFIG_LIMIT_EXCEEDED' })

    expect(fs.readFileSync(repoFilePath(), 'utf8')).toBe(originalBytes)
    expect(service.getPersonalSetup(repo)).toEqual(personalCommands)
    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(true)
  })

  it('allows a setup command to fill the repository up to its capacity', async () => {
    writeRepoFile({ version: 1, setupWorktree: Array.from({ length: 19 }, (_, index) => `repo-${index}`) })
    service.setPersonalSetup(repo, ['personal-cmd'])

    await service.moveItem(repo, directory, { kind: 'setup', command: 'personal-cmd', to: 'repo' })

    const raw = JSON.parse(fs.readFileSync(repoFilePath(), 'utf8')) as { setupWorktree: string[] }
    expect(raw.setupWorktree).toHaveLength(20)
    expect(service.getPersonalSetup(repo)).toEqual([])
  })

  it('allows a setup command to fill personal storage up to its capacity', async () => {
    service.setPersonalSetup(repo, Array.from({ length: 19 }, (_, index) => `personal-${index}`))
    writeRepoFile({ version: 1, setupWorktree: ['repo-cmd'] })

    await service.moveItem(repo, directory, { kind: 'setup', command: 'repo-cmd', to: 'personal' })

    expect(service.getPersonalSetup(repo)).toHaveLength(20)
    expect(fs.existsSync(repoFilePath())).toBe(false)
  })

  it('restores the repository file and personal settings when the file write fails', async () => {
    service.setPersonalActions(repo, [createAction()])
    const writeSeam = service as unknown as { writeRepoFile(filePath: string, file: unknown): void }
    const writeSpy = vi.spyOn(writeSeam, 'writeRepoFile').mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })).rejects.toThrow('disk full')
    writeSpy.mockRestore()

    expect(fs.existsSync(repoFilePath())).toBe(false)
    expect(service.getPersonalActions(repo)).toEqual([createAction()])

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })
    expect(service.getPersonalActions(repo)).toEqual([])
    expect(fs.existsSync(repoFilePath())).toBe(true)
  })

  it('keeps the repository file and personal settings when the delete fails', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })
    const originalBytes = fs.readFileSync(repoFilePath(), 'utf8')
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw new Error('read-only')
    })

    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })).rejects.toThrow(
      'read-only',
    )
    rmSpy.mockRestore()

    expect(fs.readFileSync(repoFilePath(), 'utf8')).toBe(originalBytes)
    expect(service.getPersonalActions(repo)).toEqual([])

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })
    expect(fs.existsSync(repoFilePath())).toBe(false)
    expect(service.getPersonalActions(repo)).toEqual([createAction()])
  })

  it('keeps the repository file when the file write fails moving back', async () => {
    writeRepoFile({
      version: 1,
      projectActions: [
        { id: 'serve', name: 'Serve', command: 'pnpm dev' },
        { id: 'test', name: 'Test', command: 'pnpm test' },
      ],
    })
    const originalBytes = fs.readFileSync(repoFilePath(), 'utf8')
    const writeSeam = service as unknown as { writeRepoFile(filePath: string, file: unknown): void }
    const writeSpy = vi.spyOn(writeSeam, 'writeRepoFile').mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })).rejects.toThrow(
      'disk full',
    )
    writeSpy.mockRestore()

    expect(fs.readFileSync(repoFilePath(), 'utf8')).toBe(originalBytes)
    expect(service.getPersonalActions(repo)).toEqual([])

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })
    expect(service.getPersonalActions(repo)).toEqual([createAction()])
  })

  it('restores the repository file and personal settings when the settings write fails', async () => {
    service.setPersonalActions(repo, [createAction()])
    const setSpy = vi.spyOn(service, 'setPersonalActions').mockImplementationOnce(() => {
      throw new Error('settings write failed')
    })

    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })).rejects.toThrow(
      'settings write failed',
    )
    setSpy.mockRestore()

    expect(fs.existsSync(repoFilePath())).toBe(false)
    expect(service.getPersonalActions(repo)).toEqual([createAction()])

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })
    expect(fs.existsSync(repoFilePath())).toBe(true)
    expect(service.getPersonalActions(repo)).toEqual([])
  })

  it('restores the repository file and rolls back personal settings when the trust write fails', async () => {
    service.setPersonalActions(repo, [createAction()])
    const trustSeam = service as unknown as { setRepoTrust(repo: Repo, hash: string | null): void }
    const trustSpy = vi.spyOn(trustSeam, 'setRepoTrust').mockImplementationOnce(() => {
      throw new Error('trust write failed')
    })

    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })).rejects.toThrow(
      'trust write failed',
    )
    trustSpy.mockRestore()

    expect(fs.existsSync(repoFilePath())).toBe(false)
    expect(service.getPersonalActions(repo)).toEqual([createAction()])
    expect((await service.getConfig(repo, directory)).repoFile.exists).toBe(false)

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'repo' })
    expect((await service.getConfig(repo, directory)).repoFile.trusted).toBe(true)
  })

  it('keeps the repository file when the settings write fails moving back', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })
    const originalBytes = fs.readFileSync(repoFilePath(), 'utf8')
    const setSpy = vi.spyOn(service, 'setPersonalActions').mockImplementationOnce(() => {
      throw new Error('settings write failed')
    })

    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })).rejects.toThrow(
      'settings write failed',
    )
    setSpy.mockRestore()

    expect(fs.readFileSync(repoFilePath(), 'utf8')).toBe(originalBytes)
    expect(service.getPersonalActions(repo)).toEqual([])

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })
    expect(service.getPersonalActions(repo)).toEqual([createAction()])
    expect(fs.existsSync(repoFilePath())).toBe(false)
  })

  it('keeps the repository file when the trust write fails moving back', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev' }] })
    const originalBytes = fs.readFileSync(repoFilePath(), 'utf8')
    const trustSeam = service as unknown as { setRepoTrust(repo: Repo, hash: string | null): void }
    const trustSpy = vi.spyOn(trustSeam, 'setRepoTrust').mockImplementationOnce(() => {
      throw new Error('trust write failed')
    })

    await expect(service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })).rejects.toThrow(
      'trust write failed',
    )
    trustSpy.mockRestore()

    expect(fs.readFileSync(repoFilePath(), 'utf8')).toBe(originalBytes)
    expect(service.getPersonalActions(repo)).toEqual([])

    await service.moveItem(repo, directory, { kind: 'action', id: 'serve', to: 'personal' })
    expect(service.getPersonalActions(repo)).toEqual([createAction()])
  })
})

describe('ProjectConfigService runAction', () => {
  let db: Database
  let service: ProjectConfigService
  let repo: Repo
  let directory: string

  function writeRepoFile(content: unknown): void {
    const filePath = path.join(directory, '.ocm', 'project.json')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2))
  }

  function createFakeTerminalService(terminals: TerminalInfo[] = []) {
    const list = vi.fn(async () => terminals)
    const create = vi.fn(
      async (target: string, input: CreateTerminalInput): Promise<TerminalInfo> => ({
        id: 'pty-1',
        title: formatTerminalTitle({ kind: input.kind, name: input.name, actionId: input.actionId }),
        kind: input.kind,
        ...(input.actionId ? { actionId: input.actionId } : {}),
        cwd: target,
        status: 'running',
      }),
    )
    return { service: { list, create } as unknown as TerminalService, list, create }
  }

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    service = createService(db)
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-run-action-'))
    repo = createRepo(db, {
      localPath: directory,
      sourcePath: directory,
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('creates an action terminal with /bin/sh -c and the encoded action id', async () => {
    service.setPersonalActions(repo, [createAction({ url: 'http://localhost:5173/{worktree}' })])
    const terminalService = createFakeTerminalService()

    const response = await service.runAction(repo, directory, 'serve', terminalService.service)

    expect(terminalService.create).toHaveBeenCalledWith(directory, {
      kind: 'action',
      actionId: 'serve',
      name: 'Serve',
      command: '/bin/sh',
      args: ['-c', 'pnpm dev'],
    })
    expect(response).toEqual({
      terminal: {
        id: 'pty-1',
        title: 'ocm:action:serve:Serve',
        kind: 'action',
        actionId: 'serve',
        cwd: directory,
        status: 'running',
      },
      alreadyRunning: false,
      resolvedUrl: `http://localhost:5173/${path.basename(directory)}`,
      autoOpenUrl: false,
    })
  })

  it('returns an already running action terminal without creating another', async () => {
    service.setPersonalActions(repo, [createAction()])
    const running: TerminalInfo = {
      id: 'pty-existing',
      title: 'Serve',
      kind: 'action',
      actionId: 'serve',
      cwd: directory,
      status: 'running',
    }
    const terminalService = createFakeTerminalService([running])

    const response = await service.runAction(repo, directory, 'serve', terminalService.service)

    expect(terminalService.create).not.toHaveBeenCalled()
    expect(response.alreadyRunning).toBe(true)
    expect(response.terminal).toEqual(running)
  })

  it('returns 404 for an unknown action', async () => {
    const terminalService = createFakeTerminalService()

    await expect(service.runAction(repo, directory, 'missing', terminalService.service)).rejects.toMatchObject({
      status: 404,
    })
    expect(terminalService.create).not.toHaveBeenCalled()
  })

  it('rejects an untrusted repository action with the current hash', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'repo-serve', name: 'Serve', command: 'pnpm dev' }] })
    const terminalService = createFakeTerminalService()

    let caught: unknown
    try {
      await service.runAction(repo, directory, 'repo-serve', terminalService.service)
    } catch (error: unknown) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ProjectConfigError)
    expect((caught as ProjectConfigError).status).toBe(409)
    expect((caught as ProjectConfigError).code).toBe('REPO_CONFIG_UNTRUSTED')
    expect((caught as ProjectConfigError).details).toMatchObject({ hash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(terminalService.create).not.toHaveBeenCalled()
  })

  it('runs a trusted repository action', async () => {
    writeRepoFile({ version: 1, projectActions: [{ id: 'repo-serve', name: 'Serve', command: 'pnpm dev' }] })
    const first = await service.getConfig(repo, directory)
    await service.trustRepoFile(repo, directory, first.repoFile.hash ?? '')
    const terminalService = createFakeTerminalService()

    const response = await service.runAction(repo, directory, 'repo-serve', terminalService.service)

    expect(response.alreadyRunning).toBe(false)
    expect(terminalService.create).toHaveBeenCalledWith(directory, expect.objectContaining({ actionId: 'repo-serve' }))
  })

  it('resolves {worktree} and {branch} against a real git checkout', async () => {
    const gitDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-run-branch-'))
    try {
      execSync(`git init "${gitDirectory}"`)
      execSync(`git -C "${gitDirectory}" config user.email test@test.com`)
      execSync(`git -C "${gitDirectory}" config user.name Test`)
      execSync(`git -C "${gitDirectory}" commit --allow-empty -m "Initial commit"`)
      execSync(`git -C "${gitDirectory}" checkout -b feature/auth`)

      const url = await service.resolveActionUrl('http://localhost:3000/{worktree}/{branch}', gitDirectory)

      expect(url).toBe(`http://localhost:3000/${path.basename(gitDirectory)}/feature/auth`)
    } finally {
      fs.rmSync(gitDirectory, { recursive: true, force: true })
    }
  })

  it('returns the template unchanged when the branch cannot be resolved', async () => {
    const template = 'http://localhost:3000/{branch}'

    await expect(service.resolveActionUrl(template, directory)).resolves.toBe(template)
  })

  it('creates exactly one terminal when the same action runs concurrently in one directory', async () => {
    service.setPersonalActions(repo, [createAction()])
    const gate = createDeferred()
    const terminalService = createStatefulTerminalService(gate)

    const first = service.runAction(repo, directory, 'serve', terminalService.service)
    const second = service.runAction(repo, directory, 'serve', terminalService.service)
    await flushAsync()
    gate.resolve()

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(terminalService.create).toHaveBeenCalledTimes(1)
    expect(firstResult.alreadyRunning).toBe(false)
    expect(secondResult.alreadyRunning).toBe(true)
    expect(secondResult.terminal.id).toBe(firstResult.terminal.id)
  })

  it('releases the run key after a failed create so a retry can start', async () => {
    service.setPersonalActions(repo, [createAction()])
    const terminals: TerminalInfo[] = []
    let attempts = 0
    const list = vi.fn(async (target: string) => terminals.filter((terminal) => terminal.cwd === target))
    const create = vi.fn(async (target: string, input: CreateTerminalInput): Promise<TerminalInfo> => {
      attempts += 1
      if (attempts === 1) {
        throw new Error('spawn failed')
      }
      const terminal: TerminalInfo = {
        id: `pty-${attempts}`,
        title: formatTerminalTitle({ kind: input.kind, name: input.name, actionId: input.actionId }),
        kind: input.kind,
        ...(input.actionId ? { actionId: input.actionId } : {}),
        cwd: target,
        status: 'running',
      }
      terminals.push(terminal)
      return terminal
    })
    const terminalService = { list, create } as unknown as TerminalService

    await expect(service.runAction(repo, directory, 'serve', terminalService)).rejects.toThrow('spawn failed')

    const response = await service.runAction(repo, directory, 'serve', terminalService)

    expect(response.alreadyRunning).toBe(false)
    expect(response.terminal.id).toBe('pty-2')
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('does not serialize runs for different directories', async () => {
    service.setPersonalActions(repo, [createAction()])
    const otherDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-run-action-other-'))
    try {
      const gate = createDeferred()
      const terminalService = createStatefulTerminalService(gate)

      const first = service.runAction(repo, directory, 'serve', terminalService.service)
      const second = service.runAction(repo, otherDirectory, 'serve', terminalService.service)
      await flushAsync()

      expect(terminalService.create).toHaveBeenCalledTimes(2)

      gate.resolve()
      await Promise.all([first, second])
    } finally {
      fs.rmSync(otherDirectory, { recursive: true, force: true })
    }
  })
})

describe('ProjectConfigService runWorktreeSetup', () => {
  let db: Database
  let service: ProjectConfigService
  let repo: Repo
  let directory: string

  function writeRepoFile(content: unknown): void {
    const filePath = path.join(directory, '.ocm', 'project.json')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2))
  }

  function createFakeTerminalService() {
    const create = vi.fn(
      async (target: string, input: CreateTerminalInput): Promise<TerminalInfo> => ({
        id: 'pty-setup',
        title: formatTerminalTitle({ kind: input.kind, name: input.name }),
        kind: input.kind,
        cwd: target,
        status: 'running',
      }),
    )
    return { service: { create } as unknown as TerminalService, create }
  }

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    service = createService(db)
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocm-worktree-setup-'))
    repo = createRepo(db, {
      localPath: directory,
      sourcePath: directory,
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: Date.now(),
      isLocal: true,
    })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('starts a setup terminal with the personal commands and ROOT_PROJECT_PATH', async () => {
    service.setPersonalSetup(repo, ['pnpm install', 'pnpm build'])
    const terminalService = createFakeTerminalService()

    const result = await service.runWorktreeSetup(repo, directory, terminalService.service)

    expect(terminalService.create).toHaveBeenCalledWith(directory, {
      kind: 'setup',
      name: 'Worktree setup',
      command: '/bin/sh',
      args: ['-c', 'set -e\npnpm install\npnpm build'],
      env: { ROOT_PROJECT_PATH: repo.fullPath },
    })
    expect(result).toEqual({
      status: 'started',
      terminal: {
        id: 'pty-setup',
        title: 'ocm:setup:Worktree setup',
        kind: 'setup',
        cwd: directory,
        status: 'running',
      },
      repoCommandsSkipped: false,
    })
  })

  it('excludes untrusted repository commands and reports them skipped', async () => {
    service.setPersonalSetup(repo, ['pnpm install'])
    writeRepoFile({ version: 1, setupWorktree: ['pnpm repo-setup'] })
    const terminalService = createFakeTerminalService()

    const result = await service.runWorktreeSetup(repo, directory, terminalService.service)

    expect(terminalService.create).toHaveBeenCalledWith(
      directory,
      expect.objectContaining({ args: ['-c', 'set -e\npnpm install'] }),
    )
    expect(result).toMatchObject({ status: 'started', repoCommandsSkipped: true })
  })

  it('includes trusted repository commands', async () => {
    writeRepoFile({ version: 1, setupWorktree: ['pnpm repo-setup'] })
    const first = await service.getConfig(repo, directory)
    await service.trustRepoFile(repo, directory, first.repoFile.hash ?? '')
    const terminalService = createFakeTerminalService()

    const result = await service.runWorktreeSetup(repo, directory, terminalService.service)

    expect(terminalService.create).toHaveBeenCalledWith(
      directory,
      expect.objectContaining({ args: ['-c', 'set -e\npnpm repo-setup'] }),
    )
    expect(result).toMatchObject({ status: 'started', repoCommandsSkipped: false })
  })

  it('returns skipped when the only commands are untrusted repository commands', async () => {
    writeRepoFile({ version: 1, setupWorktree: ['pnpm repo-setup'] })
    const terminalService = createFakeTerminalService()

    const result = await service.runWorktreeSetup(repo, directory, terminalService.service)

    expect(result).toEqual({ status: 'skipped', reason: 'untrusted' })
    expect(terminalService.create).not.toHaveBeenCalled()
  })

  it('returns none when no commands are configured', async () => {
    const terminalService = createFakeTerminalService()

    const result = await service.runWorktreeSetup(repo, directory, terminalService.service)

    expect(result).toEqual({ status: 'none' })
    expect(terminalService.create).not.toHaveBeenCalled()
  })

  it('returns failed when the terminal cannot be created', async () => {
    service.setPersonalSetup(repo, ['pnpm install'])
    const create = vi.fn(async () => {
      throw new Error('spawn failed')
    })
    const terminalService = { create } as unknown as TerminalService

    const result = await service.runWorktreeSetup(repo, directory, terminalService)

    expect(result).toEqual({ status: 'failed', error: 'spawn failed' })
  })
})
