import { describe, it, expect } from 'vitest'
import { buildConflictResolutionPrompt } from './git-conflict-prompt'

describe('buildConflictResolutionPrompt', () => {
  it('names the operation, branch, and every conflicted file', () => {
    const prompt = buildConflictResolutionPrompt({
      operation: { kind: 'merge', conflictedFiles: ['src/a.ts', 'src/b.ts'] },
      branch: 'feature/x',
    })

    expect(prompt).toContain('git merge')
    expect(prompt).toContain('feature/x')
    expect(prompt).toContain('- src/a.ts')
    expect(prompt).toContain('- src/b.ts')
  })

  it('preserves exact unicode and special-character conflicted file names', () => {
    const prompt = buildConflictResolutionPrompt({
      operation: { kind: 'merge', conflictedFiles: ['café.txt', 'a b"c.txt'] },
      branch: 'feature/x',
    })

    expect(prompt).toContain('- café.txt')
    expect(prompt).toContain('- a b"c.txt')
    expect(prompt).not.toContain('\\303')
    expect(prompt).not.toContain('"a b\\"c.txt"')
  })

  it('instructs the agent to confirm the strategy before editing', () => {
    const prompt = buildConflictResolutionPrompt({
      operation: { kind: 'rebase', conflictedFiles: ['file.txt'] },
      branch: 'main',
    })

    expect(prompt).toContain('Wait for the user to confirm')
    expect(prompt).toContain('before editing')
  })

  it('uses the kind-specific continue command with a non-interactive editor', () => {
    const prompt = buildConflictResolutionPrompt({
      operation: { kind: 'cherry-pick', conflictedFiles: ['file.txt'] },
      branch: 'main',
    })

    expect(prompt).toContain('GIT_EDITOR=true git cherry-pick --continue')
    expect(prompt).toContain('git add')
  })

  it('forbids abort and force-push unless the user asks', () => {
    const prompt = buildConflictResolutionPrompt({
      operation: { kind: 'revert', conflictedFiles: ['file.txt'] },
      branch: 'main',
    })

    expect(prompt).toContain('git revert --abort')
    expect(prompt).toContain('force-push')
    expect(prompt).toContain('unless the user explicitly asks')
  })
})
