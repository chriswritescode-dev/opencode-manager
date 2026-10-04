import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from 'bun:sqlite'
import { getOpenCodeConfigHome } from '@opencode-manager/shared/config/env'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { SettingsService } from '../../src/services/settings'
import {
  getEffectiveGitIdentity,
  getGitIdentityEnvForDirectory,
  getManagerGitConfigPath,
  setRepoGitIdentity,
  syncManagerGitIdentityConfig,
} from '../../src/services/git-identity'
import { createCommittedRepo, git, uniqueName } from '../helpers/git-fixtures'

const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'git-identity-test-'))
const homeDir = path.join(workspaceRoot, 'home')
process.env.WORKSPACE_PATH = workspaceRoot
process.env.GIT_CONFIG_NOSYSTEM = '1'
delete process.env.GIT_CONFIG_GLOBAL
process.env.HOME = homeDir
process.env.XDG_CONFIG_HOME = getOpenCodeConfigHome()
mkdirSync(homeDir, { recursive: true })

function readLocalConfig(repoPath: string, key: string): string | null {
  try {
    return execFileSync('git', ['-C', repoPath, 'config', '--local', '--get', key], {
      encoding: 'utf-8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
    }).trim()
  } catch {
    return null
  }
}

function initRepoWithoutIdentity(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true })
  git(['init', '-b', 'main'], repoPath)
  git(['-c', 'user.name=Init', '-c', 'user.email=init@test.com', 'commit', '--allow-empty', '-m', 'init'], repoPath)
}

describe('git-identity', () => {
  let db: Database
  let settingsService: SettingsService

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    settingsService = new SettingsService(db)
    rmSync(getManagerGitConfigPath(), { force: true })
    rmSync(path.join(homeDir, '.gitconfig'), { force: true })
  })

  afterEach(() => {
    db.close()
  })

  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  describe('setRepoGitIdentity', () => {
    it('writes both local keys and unsets them when given null', async () => {
      const repoPath = path.join(workspaceRoot, uniqueName('set-identity'))
      createCommittedRepo(repoPath)

      await setRepoGitIdentity(repoPath, { name: 'Work User', email: 'work@example.com' })

      expect(readLocalConfig(repoPath, 'user.name')).toBe('Work User')
      expect(readLocalConfig(repoPath, 'user.email')).toBe('work@example.com')

      await setRepoGitIdentity(repoPath, null)

      expect(readLocalConfig(repoPath, 'user.name')).toBeNull()
      expect(readLocalConfig(repoPath, 'user.email')).toBeNull()
    })
  })

  describe('getEffectiveGitIdentity', () => {
    it('reports repository scope and the matching preset id for a local identity', async () => {
      const repoPath = path.join(workspaceRoot, uniqueName('effective-repo'))
      createCommittedRepo(repoPath)
      settingsService.updateSettings({
        gitIdentities: [{ id: 'work', name: 'Work User', email: 'work@example.com' }],
      })
      await setRepoGitIdentity(repoPath, { name: 'Work User', email: 'work@example.com' })

      const identity = await getEffectiveGitIdentity(repoPath, db)

      expect(identity).toEqual({
        name: 'Work User',
        email: 'work@example.com',
        scope: 'repository',
        presetId: 'work',
      })
    })

    it('reports default scope when only the Manager config file supplies the identity', async () => {
      const repoPath = path.join(workspaceRoot, uniqueName('effective-default'))
      initRepoWithoutIdentity(repoPath)
      settingsService.updateSettings({ gitIdentity: { name: 'Manager User', email: 'manager@example.com' } })

      const sync = await syncManagerGitIdentityConfig(db)
      const identity = await getEffectiveGitIdentity(repoPath, db)

      expect(sync.error).toBeNull()
      expect(identity).toEqual({
        name: 'Manager User',
        email: 'manager@example.com',
        scope: 'default',
        presetId: null,
      })
    })

    it('reports global scope for a user ~/.gitconfig and none when unset', async () => {
      const repoPath = path.join(workspaceRoot, uniqueName('effective-global'))
      initRepoWithoutIdentity(repoPath)

      expect(await getEffectiveGitIdentity(repoPath, db)).toEqual({
        name: null,
        email: null,
        scope: 'none',
        presetId: null,
      })

      writeFileSync(path.join(homeDir, '.gitconfig'), '[user]\n\tname = Global User\n\temail = global@example.com\n')

      expect(await getEffectiveGitIdentity(repoPath, db)).toEqual({
        name: 'Global User',
        email: 'global@example.com',
        scope: 'global',
        presetId: null,
      })
    })

    it('lets a user-set local identity win over the Manager default', async () => {
      const repoPath = path.join(workspaceRoot, uniqueName('effective-local-wins'))
      initRepoWithoutIdentity(repoPath)
      settingsService.updateSettings({ gitIdentity: { name: 'Manager User', email: 'manager@example.com' } })
      await syncManagerGitIdentityConfig(db)
      await setRepoGitIdentity(repoPath, { name: 'Local User', email: 'local@example.com' })

      const identity = await getEffectiveGitIdentity(repoPath, db)

      expect(identity.scope).toBe('repository')
      expect(identity.name).toBe('Local User')
      expect(identity.email).toBe('local@example.com')
    })
  })

  describe('getGitIdentityEnvForDirectory', () => {
    it('returns the identity env when both name and email resolve', async () => {
      const repoPath = path.join(workspaceRoot, uniqueName('env-identity'))
      createCommittedRepo(repoPath)
      await setRepoGitIdentity(repoPath, { name: 'Env User', email: 'env@example.com' })

      expect(await getGitIdentityEnvForDirectory(repoPath, db)).toEqual({
        GIT_AUTHOR_NAME: 'Env User',
        GIT_AUTHOR_EMAIL: 'env@example.com',
        GIT_COMMITTER_NAME: 'Env User',
        GIT_COMMITTER_EMAIL: 'env@example.com',
      })
    })

    it('returns an empty env when no identity resolves', async () => {
      const repoPath = path.join(workspaceRoot, uniqueName('env-none'))
      initRepoWithoutIdentity(repoPath)

      expect(await getGitIdentityEnvForDirectory(repoPath, db)).toEqual({})
    })
  })

  describe('syncManagerGitIdentityConfig', () => {
    it('writes and unsets keys without touching other content of the file', async () => {
      const managerPath = getManagerGitConfigPath()
      mkdirSync(path.dirname(managerPath), { recursive: true })
      writeFileSync(managerPath, '[credential]\n\thelper = store\n')

      settingsService.updateSettings({ gitIdentity: { name: 'Manager User', email: 'manager@example.com' } })
      const written = await syncManagerGitIdentityConfig(db)

      expect(written.error).toBeNull()
      const afterWrite = readFileSync(managerPath, 'utf-8')
      expect(afterWrite).toContain('[credential]')
      expect(afterWrite).toContain('helper = store')
      expect(afterWrite).toContain('name = Manager User')
      expect(afterWrite).toContain('email = manager@example.com')

      settingsService.updateSettings({ gitIdentity: { name: '', email: '' } })
      const cleared = await syncManagerGitIdentityConfig(db)

      expect(cleared.identity).toBeNull()
      expect(cleared.error).toBeNull()
      const afterUnset = readFileSync(managerPath, 'utf-8')
      expect(afterUnset).toContain('[credential]')
      expect(afterUnset).toContain('helper = store')
      expect(afterUnset).not.toContain('name =')
      expect(afterUnset).not.toContain('email =')
    })

    it('keeps a default identity with an empty email so commits still have an author', async () => {
      settingsService.updateSettings({ gitIdentity: { name: 'OpenCode Agent', email: '' } })
      const result = await syncManagerGitIdentityConfig(db)

      expect(result.error).toBeNull()
      expect(result.identity).toEqual({ name: 'OpenCode Agent', email: '' })

      const repoPath = path.join(workspaceRoot, uniqueName('default-empty-email'))
      initRepoWithoutIdentity(repoPath)
      git(['-c', 'user.useConfigOnly=true', 'commit', '--allow-empty', '-m', 'agent'], repoPath)

      expect(git(['log', '-1', '--format=%an <%ae>'], repoPath)).toBe('OpenCode Agent <>')
      expect(await getGitIdentityEnvForDirectory(repoPath, db)).toEqual({
        GIT_AUTHOR_NAME: 'OpenCode Agent',
        GIT_AUTHOR_EMAIL: '',
        GIT_COMMITTER_NAME: 'OpenCode Agent',
        GIT_COMMITTER_EMAIL: '',
      })
    })
  })
})
