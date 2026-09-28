import { describe, expect, it } from 'vitest'
import { getAgentStyleVars } from './agent-colors'

const themeNameCases: Array<[string, string]> = [
  ['primary', 'var(--color-primary)'],
  ['secondary', 'var(--color-foreground)'],
  ['accent', 'var(--color-info)'],
  ['success', 'var(--color-success)'],
  ['warning', 'var(--color-warning)'],
  ['error', 'var(--color-destructive)'],
  ['info', 'var(--color-info)'],
]

describe('getAgentStyleVars', () => {
  it('uses a six-digit hex api color as-is', () => {
    const vars = getAgentStyleVars('plan', '#123abc')

    expect(vars['--agent-color']).toBe('#123abc')
    expect(vars['--agent-bg']).toBe('color-mix(in oklab, #123abc 20%, transparent)')
  })

  it.each(themeNameCases)('maps the %s theme name to %s', (name, expected) => {
    expect(getAgentStyleVars('custom', name)['--agent-color']).toBe(expected)
  })

  it('maps theme names case-insensitively', () => {
    expect(getAgentStyleVars('custom', 'PRIMARY')['--agent-color']).toBe('var(--color-primary)')
  })

  it.each(['plan', 'build', 'docs', 'ask'])('maps the %s default agent name to its token', (name) => {
    expect(getAgentStyleVars(name)['--agent-color']).toBe(`var(--color-agent-${name})`)
  })

  it('maps default agent names case-insensitively', () => {
    expect(getAgentStyleVars('PLAN')['--agent-color']).toBe('var(--color-agent-plan)')
    expect(getAgentStyleVars('Build')['--agent-color']).toBe('var(--color-agent-build)')
  })

  it('falls back to the muted foreground for unknown agents', () => {
    expect(getAgentStyleVars('unknown')['--agent-color']).toBe('var(--color-muted-foreground)')
  })

  it('derives the alpha variants from the resolved color', () => {
    const vars = getAgentStyleVars('plan')

    expect(vars['--agent-bg']).toBe('color-mix(in oklab, var(--color-agent-plan) 20%, transparent)')
    expect(vars['--agent-bg-hover']).toBe('color-mix(in oklab, var(--color-agent-plan) 30%, transparent)')
    expect(vars['--agent-border']).toBe('color-mix(in oklab, var(--color-agent-plan) 60%, transparent)')
    expect(vars['--agent-border-hover']).toBe('color-mix(in oklab, var(--color-agent-plan) 50%, transparent)')
    expect(vars['--agent-shadow']).toBe('color-mix(in oklab, var(--color-agent-plan) 20%, transparent)')
    expect(vars['--agent-shadow-hover']).toBe('color-mix(in oklab, var(--color-agent-plan) 30%, transparent)')
  })

  it('returns only the mode-independent vars', () => {
    expect(Object.keys(getAgentStyleVars('plan')).sort()).toEqual([
      '--agent-bg',
      '--agent-bg-hover',
      '--agent-border',
      '--agent-border-hover',
      '--agent-color',
      '--agent-shadow',
      '--agent-shadow-hover',
    ])
  })
})
