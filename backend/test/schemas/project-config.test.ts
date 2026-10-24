import { describe, it, expect } from 'vitest'
import { REPO_PROJECT_ENV_MAX_ENTRIES, RepoProjectFileSchema } from '@opencode-manager/shared/schemas'

function parseEnv(env: Record<string, string>) {
  return RepoProjectFileSchema.safeParse({ version: 1, env })
}

describe('RepoProjectFileSchema env', () => {
  it('accepts valid expressions and keeps key case', () => {
    const result = parseEnv({ API_URL: 'https://${{ vars.HOST }}', plainVar: 'literal' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.env).toEqual({ API_URL: 'https://${{ vars.HOST }}', plainVar: 'literal' })
    }
  })

  it('lower-cases the environment name', () => {
    const result = RepoProjectFileSchema.safeParse({ version: 1, environment: 'Prod', env: { A: 'x' } })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.environment).toBe('prod')
    }
  })

  it('rejects a reserved environment variable name with an actionable message', () => {
    const result = parseEnv({ OCM_TOKEN: 'x' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('OCM_TOKEN is reserved for Manager or the runtime')
      expect(result.error.issues[0]?.path).toEqual(['env', 'OCM_TOKEN'])
    }
    expect(parseEnv({ PATH: '/tmp' }).success).toBe(false)
    expect(parseEnv({ OPENCODE_TOKEN: 'x' }).success).toBe(false)
  })

  it('rejects git authentication names with an actionable message', () => {
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GIT_AUTHOR_NAME', 'git_committer_email']) {
      const result = parseEnv({ [name]: 'x' })

      expect(result.success, name).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          `${name} is reserved for git authentication; map the value in a local env file or use a secret instead`,
        )
        expect(result.error.issues[0]?.path).toEqual(['env', name])
      }
    }
    expect(parseEnv({ GITHUB_ACTIONS_SUMMARY: 'x' }).success).toBe(false)
    expect(parseEnv({ GITLAB_TOKEN: 'x' }).success).toBe(true)
  })

  it('rejects an invalid environment variable name with an actionable message', () => {
    const result = parseEnv({ '1BAD': 'x' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('1BAD is not a valid environment variable name')
      expect(result.error.issues[0]?.path).toEqual(['env', '1BAD'])
    }
  })

  it('rejects an unsupported expression with an actionable error', () => {
    const result = parseEnv({ TOKEN: '${{ github.sha }}' })

    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues[0]
      expect(issue?.message).toContain('Unsupported expression')
      expect(issue?.message).toContain('github.sha')
      expect(issue?.path).toEqual(['env', 'TOKEN'])
    }
  })

  it('rejects an environment value over 4000 characters', () => {
    expect(parseEnv({ TOKEN: 'a'.repeat(4001) }).success).toBe(false)
    expect(parseEnv({ TOKEN: 'a'.repeat(4000) }).success).toBe(true)
  })

  it('allows up to the environment entry limit and rejects more', () => {
    const atLimit = Object.fromEntries(
      Array.from({ length: REPO_PROJECT_ENV_MAX_ENTRIES }, (_, index) => [`VAR_${index}`, 'x']),
    )
    const overLimit = Object.fromEntries(
      Array.from({ length: REPO_PROJECT_ENV_MAX_ENTRIES + 1 }, (_, index) => [`VAR_${index}`, 'x']),
    )

    expect(parseEnv(atLimit).success).toBe(true)
    expect(parseEnv(overLimit).success).toBe(false)
  })
})
