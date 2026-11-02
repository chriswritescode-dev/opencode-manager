import { Info } from '@opencode/schema/config'
import { Schema } from 'effect'

export interface OpenCodeConfigValidationIssue {
  path: string
  message: string
}

export type OpenCodeConfigValidationResult =
  | { success: true }
  | { success: false; issues: OpenCodeConfigValidationIssue[] }

const standardSchema = Schema.toStandardSchemaV1(Info, {
  parseOptions: { errors: 'all', onExcessProperty: 'ignore' },
})

function toIssuePath(path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined): string {
  if (!path || path.length === 0) return 'root'
  return path
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.')
}

/**
 * Validates a parsed OpenCode config document against the v2 `Config.Info` schema, ignoring
 * unknown keys so v1-only fields in existing files stay loadable.
 */
export function validateOpenCodeConfig(value: unknown): OpenCodeConfigValidationResult {
  const result = standardSchema['~standard'].validate(value)
  if (result instanceof Promise) {
    throw new Error('OpenCode config validation must be synchronous')
  }
  if (!result.issues) return { success: true }
  return {
    success: false,
    issues: result.issues.map((issue) => ({
      path: toIssuePath(issue.path),
      message: issue.message,
    })),
  }
}
