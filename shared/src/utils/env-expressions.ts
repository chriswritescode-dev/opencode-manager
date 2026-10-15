export type EnvExpressionContext = 'secrets' | 'vars'

export interface EnvExpressionReference {
  context: EnvExpressionContext
  name: string
}

export type ParseEnvExpressionReferencesResult =
  | { ok: true; references: EnvExpressionReference[] }
  | { ok: false; error: string }

const ENV_EXPRESSION_PATTERN = /\$\{\{([\s\S]*?)\}\}/g

const ENV_EXPRESSION_REFERENCE_PATTERN = /^\s*(secrets|vars)\.([A-Za-z_][A-Za-z0-9_]*)\s*$/i

function toReference(match: RegExpExecArray): EnvExpressionReference {
  return {
    context: (match[1] ?? '').toLowerCase() as EnvExpressionContext,
    name: (match[2] ?? '').toUpperCase(),
  }
}

/**
 * Parses every `${{ ... }}` occurrence in a value, accepting only
 * `secrets.<NAME>` and `vars.<NAME>` references. The context is
 * case-insensitive and the name is normalized to upper case.
 */
export function parseEnvExpressionReferences(value: string): ParseEnvExpressionReferencesResult {
  const references: EnvExpressionReference[] = []

  for (const expression of value.matchAll(ENV_EXPRESSION_PATTERN)) {
    const reference = ENV_EXPRESSION_REFERENCE_PATTERN.exec(expression[1] ?? '')
    if (!reference) {
      return {
        ok: false,
        error: `Unsupported expression "${expression[0]}": only secrets.<NAME> and vars.<NAME> are supported`,
      }
    }
    references.push(toReference(reference))
  }

  return { ok: true, references }
}

/**
 * Replaces every `${{ secrets.<NAME> }}` / `${{ vars.<NAME> }}` occurrence with
 * the value returned by `lookup`. A reference that resolves to `undefined`
 * becomes an empty string and is reported in `missing`, matching GitHub Actions.
 * Unsupported expressions are left untouched.
 */
export function interpolateEnvExpressions(
  value: string,
  lookup: (reference: EnvExpressionReference) => string | undefined,
): { value: string; missing: EnvExpressionReference[] } {
  const missing: EnvExpressionReference[] = []

  const interpolated = value.replace(ENV_EXPRESSION_PATTERN, (expression, inner: string) => {
    const match = ENV_EXPRESSION_REFERENCE_PATTERN.exec(inner)
    if (!match) {
      return expression
    }
    const reference = toReference(match)
    const resolved = lookup(reference)
    if (resolved === undefined) {
      missing.push(reference)
      return ''
    }
    return resolved
  })

  return { value: interpolated, missing }
}
