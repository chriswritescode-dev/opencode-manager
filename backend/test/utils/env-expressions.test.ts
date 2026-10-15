import { describe, it, expect } from 'vitest'
import { interpolateEnvExpressions, parseEnvExpressionReferences } from '@opencode-manager/shared/utils'

describe('parseEnvExpressionReferences', () => {
  it('accepts a single secrets reference', () => {
    expect(parseEnvExpressionReferences('${{ secrets.TOKEN }}')).toEqual({
      ok: true,
      references: [{ context: 'secrets', name: 'TOKEN' }],
    })
  })

  it('accepts interpolation inside a larger string and multiple references', () => {
    expect(parseEnvExpressionReferences('Bearer ${{ secrets.TOKEN }} on ${{ vars.HOST }}')).toEqual({
      ok: true,
      references: [
        { context: 'secrets', name: 'TOKEN' },
        { context: 'vars', name: 'HOST' },
      ],
    })
  })

  it('treats the context case-insensitively and upper-cases the name', () => {
    expect(parseEnvExpressionReferences('${{ Secrets.my_token }}')).toEqual({
      ok: true,
      references: [{ context: 'secrets', name: 'MY_TOKEN' }],
    })
    expect(parseEnvExpressionReferences('${{ VARS.Host }}')).toEqual({
      ok: true,
      references: [{ context: 'vars', name: 'HOST' }],
    })
  })

  it('returns no references for a literal value', () => {
    expect(parseEnvExpressionReferences('plain value')).toEqual({ ok: true, references: [] })
  })

  it('rejects an unknown context', () => {
    const result = parseEnvExpressionReferences('${{ github.sha }}')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('${{ github.sha }}')
      expect(result.error).toContain('secrets.<NAME>')
    }
  })

  it('rejects an operator inside the expression', () => {
    expect(parseEnvExpressionReferences("${{ secrets.A || 'x' }}").ok).toBe(false)
  })

  it('rejects a function call inside the expression', () => {
    expect(parseEnvExpressionReferences("${{ format('{0}', vars.A) }}").ok).toBe(false)
  })

  it('rejects a reference with an invalid name', () => {
    expect(parseEnvExpressionReferences('${{ secrets.1BAD }}').ok).toBe(false)
  })
})

describe('interpolateEnvExpressions', () => {
  const lookup = (reference: { context: string; name: string }): string | undefined => {
    const values: Record<string, string> = {
      'secrets.TOKEN': 'super-secret',
      'vars.HOST': 'example.com',
    }
    return values[`${reference.context}.${reference.name}`]
  }

  it('replaces references and interpolates inside a larger string', () => {
    expect(interpolateEnvExpressions('https://${{ vars.HOST }}/${{ secrets.TOKEN }}', lookup)).toEqual({
      value: 'https://example.com/super-secret',
      missing: [],
    })
  })

  it('resolves a missing reference to an empty string and reports it', () => {
    expect(interpolateEnvExpressions('x-${{ secrets.MISSING }}-y', lookup)).toEqual({
      value: 'x--y',
      missing: [{ context: 'secrets', name: 'MISSING' }],
    })
  })

  it('leaves an unsupported expression untouched', () => {
    expect(interpolateEnvExpressions('${{ github.sha }}', lookup)).toEqual({
      value: '${{ github.sha }}',
      missing: [],
    })
  })

  it('leaves a literal value untouched', () => {
    expect(interpolateEnvExpressions('literal', lookup)).toEqual({ value: 'literal', missing: [] })
  })
})
