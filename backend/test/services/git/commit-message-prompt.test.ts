import { describe, it, expect } from 'vitest'
import {
  buildCommitMessagePrompt,
  normalizeGeneratedCommitMessage,
  MAX_COMMIT_PROMPT_DIFF_CHARS,
} from '../../../src/services/git/commit-message-prompt'

describe('buildCommitMessagePrompt', () => {
  it('includes the recent subjects and the staged stat', () => {
    const prompt = buildCommitMessagePrompt({
      stagedStat: ' src/index.ts | 4 ++--',
      stagedDiff: '+added line',
      recentSubjects: ['feat: add source control', 'fix: correct status parsing'],
    })

    expect(prompt).toContain('feat: add source control')
    expect(prompt).toContain('fix: correct status parsing')
    expect(prompt).toContain('src/index.ts | 4 ++--')
  })

  it('truncates the staged diff above the limit and marks it', () => {
    const diff = 'a'.repeat(MAX_COMMIT_PROMPT_DIFF_CHARS + 500)
    const prompt = buildCommitMessagePrompt({ stagedStat: 'stat', stagedDiff: diff, recentSubjects: [] })

    expect(prompt).toContain('[diff truncated]')
    expect(prompt).toContain('a'.repeat(MAX_COMMIT_PROMPT_DIFF_CHARS))
    expect(prompt).not.toContain(diff)
  })

  it('leaves a diff under the limit intact', () => {
    const diff = 'b'.repeat(100)
    const prompt = buildCommitMessagePrompt({ stagedStat: 'stat', stagedDiff: diff, recentSubjects: [] })

    expect(prompt).toContain(diff)
    expect(prompt).not.toContain('[diff truncated]')
  })

  it('handles an empty subject list', () => {
    const prompt = buildCommitMessagePrompt({ stagedStat: 'stat', stagedDiff: 'diff', recentSubjects: [] })

    expect(prompt).toContain('(no recent commits)')
  })
})

describe('normalizeGeneratedCommitMessage', () => {
  it('strips a surrounding code fence', () => {
    expect(normalizeGeneratedCommitMessage('```\nfeat: add thing\n```')).toBe('feat: add thing')
  })

  it('strips a fence with a language hint', () => {
    expect(normalizeGeneratedCommitMessage('```text\nfeat: add thing\n```')).toBe('feat: add thing')
  })

  it('strips a leading commit message label', () => {
    expect(normalizeGeneratedCommitMessage('Commit message: feat: add thing')).toBe('feat: add thing')
  })

  it('strips a label placed outside a surrounding fence', () => {
    expect(normalizeGeneratedCommitMessage('Commit message:\n```text\nfeat: add thing\n```')).toBe('feat: add thing')
    expect(normalizeGeneratedCommitMessage('Commit message:\n```\nfeat: add thing\n```')).toBe('feat: add thing')
  })

  it('strips a label placed inside a surrounding fence', () => {
    expect(normalizeGeneratedCommitMessage('```\nCommit message: feat: add thing\n```')).toBe('feat: add thing')
  })

  it('normalizes a labeled empty fence to an empty string', () => {
    expect(normalizeGeneratedCommitMessage('Commit message:\n```\n```')).toBe('')
    expect(normalizeGeneratedCommitMessage('Commit message:\n```text\n```')).toBe('')
  })

  it('preserves a body separated from the subject', () => {
    expect(normalizeGeneratedCommitMessage('feat: add thing\n\nExplain the change')).toBe('feat: add thing\n\nExplain the change')
  })

  it('returns an empty string when nothing remains', () => {
    expect(normalizeGeneratedCommitMessage('   \n  ')).toBe('')
    expect(normalizeGeneratedCommitMessage('```\n```')).toBe('')
  })
})
