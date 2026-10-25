import { ENV_NAME_PATTERN } from '../schemas/secrets'

export type EnvExpressionContext = 'secrets' | 'vars'

export interface EnvExpressionReference {
  context: EnvExpressionContext
  name: string
}

export type ParseEnvExpressionReferencesResult =
  | { ok: true; references: EnvExpressionReference[] }
  | { ok: false; error: string }

const ENV_EXPRESSION_PATTERN = /\$\{\{([\s\S]*?)\}\}/g

const ENV_EXPRESSION_REFERENCE_PATTERN = /^\s*(secrets|vars)\.(\S+)\s*$/i

function toReference(match: RegExpExecArray): EnvExpressionReference {
  return {
    context: (match[1] ?? '').toLowerCase() as EnvExpressionContext,
    name: (match[2] ?? '').toUpperCase(),
  }
}

function matchReference(inner: string): EnvExpressionReference | null {
  const match = ENV_EXPRESSION_REFERENCE_PATTERN.exec(inner)
  if (!match || !ENV_NAME_PATTERN.test(match[2] ?? '')) return null
  return toReference(match)
}

/**
 * Parses every `${{ ... }}` occurrence in a value, accepting only
 * `secrets.<NAME>` and `vars.<NAME>` references. The context is
 * case-insensitive and the name is normalized to upper case.
 */
export function parseEnvExpressionReferences(value: string): ParseEnvExpressionReferencesResult {
  const references: EnvExpressionReference[] = []

  for (const expression of value.matchAll(ENV_EXPRESSION_PATTERN)) {
    const reference = matchReference(expression[1] ?? '')
    if (!reference) {
      return {
        ok: false,
        error: `Unsupported expression "${expression[0]}": only secrets.<NAME> and vars.<NAME> are supported`,
      }
    }
    references.push(reference)
  }

  return { ok: true, references }
}

/**
 * Replaces every `${{ secrets.<NAME> }}` / `${{ vars.<NAME> }}` occurrence with
 * the value returned by `lookup`. A reference that resolves to `undefined`
 * becomes an empty string, matching GitHub Actions. Unsupported expressions and
 * expressions with an invalid name are left untouched.
 */
export function interpolateEnvExpressions(
  value: string,
  lookup: (reference: EnvExpressionReference) => string | undefined,
): { value: string } {
  const interpolated = value.replace(ENV_EXPRESSION_PATTERN, (expression, inner: string) => {
    const reference = matchReference(inner)
    if (!reference) {
      return expression
    }
    const resolved = lookup(reference)
    return resolved === undefined ? '' : resolved
  })

  return { value: interpolated }
}
