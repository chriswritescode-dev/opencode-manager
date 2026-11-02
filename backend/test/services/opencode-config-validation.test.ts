import { describe, expect, it } from 'vitest'
import { validateOpenCodeConfig } from '@opencode-manager/shared/opencode/config-validation'

describe('validateOpenCodeConfig', () => {
  it('accepts a valid v2 config document', () => {
    expect(
      validateOpenCodeConfig({
        $schema: 'https://opencode.ai/config.json',
        model: 'anthropic/claude-sonnet-4',
        share: 'manual',
        agents: { assistant: { mode: 'primary' } },
      }),
    ).toEqual({ success: true })
  })

  it('accepts v2-only fields', () => {
    expect(
      validateOpenCodeConfig({
        shell: '/bin/zsh',
        lsp: true,
        timezone: 'Europe/Madrid',
        policies: [{ action: 'tool.use', resource: 'bash', effect: 'deny' }],
      }),
    ).toEqual({ success: true })
  })

  it('rejects invalid nested values with dotted paths', () => {
    const result = validateOpenCodeConfig({ agents: { a: { mode: 'boss' } } })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.issues.map((issue) => issue.path)).toContain('agents.a.mode')
  })

  it('rejects invalid enum values', () => {
    const result = validateOpenCodeConfig({ share: 'sometimes' })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.issues).toEqual([
      expect.objectContaining({ path: 'share' }),
    ])
  })

  it('accepts v1-only keys because unknown keys are ignored', () => {
    expect(
      validateOpenCodeConfig({
        agent: { build: { mode: 'primary' } },
        command: { deploy: { template: 'ship it' } },
        provider: { openai: { options: {} } },
        permission: { edit: 'allow' },
      }),
    ).toEqual({ success: true })
  })
})
