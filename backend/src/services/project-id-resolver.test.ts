import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { gitRemoteProjectId } from '@opencode-manager/shared/project-id'
import { isGitMainCheckout, resolveProjectId } from './project-id-resolver'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
}

describe('resolveProjectId', () => {
  let base: string

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), 'oc-resolve-project-'))
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('returns null for a non-git directory', async () => {
    const dir = mkdtempSync(path.join(base, 'non-git-'))
    expect(await resolveProjectId(dir)).toBeNull()
  })

  it('prefers the normalized origin remote hash', async () => {
    const dir = mkdtempSync(path.join(base, 'remote-'))
    execSync(`git init -q "${dir}"`)
    execSync(`git -C "${dir}" commit -q --allow-empty -m init`, { env: GIT_ENV })
    execSync(`git -C "${dir}" remote add origin git@github.com:Acme/App.git`)

    expect(await resolveProjectId(dir)).toBe(gitRemoteProjectId('git@github.com:Acme/App.git'))
  })

  it('falls back to the sorted first root commit when there is no remote', async () => {
    const dir = mkdtempSync(path.join(base, 'root-'))
    execSync(`git init -q "${dir}"`)
    execSync(`git -C "${dir}" commit -q --allow-empty -m init`, { env: GIT_ENV })

    const rootCommit = execSync(`git -C "${dir}" rev-list --max-parents=0 HEAD`).toString().trim()
    expect(await resolveProjectId(dir)).toBe(rootCommit)
  })
})

describe('isGitMainCheckout', () => {
  let base: string
  let mainRepo: string
  let worktree: string

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), 'oc-main-checkout-'))
    mainRepo = path.join(base, 'main')
    worktree = path.join(base, 'wt')
    execSync(`git init -q "${mainRepo}"`)
    execSync(`git -C "${mainRepo}" commit -q --allow-empty -m init`, {
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    })
    execSync(`git -C "${mainRepo}" worktree add -q "${worktree}" -b feature`)
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('returns true for the main checkout', async () => {
    expect(await isGitMainCheckout(mainRepo)).toBe(true)
  })

  it('returns false for a linked worktree', async () => {
    expect(await isGitMainCheckout(worktree)).toBe(false)
  })

  it('returns false for a non-git directory', async () => {
    expect(await isGitMainCheckout(base)).toBe(false)
  })
})
