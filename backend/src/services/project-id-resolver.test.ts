import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { isGitMainCheckout } from './project-id-resolver'

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
