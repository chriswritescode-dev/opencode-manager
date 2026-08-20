import { describe, it, expect } from 'vitest'
import { getRepoRelativeDisplayPath } from './display-path'

describe('getRepoRelativeDisplayPath', () => {
  it('returns root when current path equals the base path', () => {
    expect(getRepoRelativeDisplayPath('my-repo', 'my-repo')).toBe('/')
  })

  it('returns root for the assistant directory regardless of display-name casing', () => {
    expect(getRepoRelativeDisplayPath('assistant', 'assistant')).toBe('/')
  })

  it('strips the base path prefix for subdirectories', () => {
    expect(getRepoRelativeDisplayPath('assistant/.opencode/skills', 'assistant')).toBe('/.opencode/skills')
    expect(getRepoRelativeDisplayPath('my-repo/src', 'my-repo')).toBe('/src')
  })

  it('handles worktree directories with branch suffixes', () => {
    expect(getRepoRelativeDisplayPath('my-repo-feature', 'my-repo-feature')).toBe('/')
    expect(getRepoRelativeDisplayPath('my-repo-feature/src', 'my-repo-feature')).toBe('/src')
  })

  it('treats "." as the workspace root base', () => {
    expect(getRepoRelativeDisplayPath('.', '.')).toBe('/')
    expect(getRepoRelativeDisplayPath('some-repo', '.')).toBe('/some-repo')
  })

  it('falls back to the full path when outside the base path', () => {
    expect(getRepoRelativeDisplayPath('other-repo/file', 'assistant')).toBe('/other-repo/file')
  })
})
