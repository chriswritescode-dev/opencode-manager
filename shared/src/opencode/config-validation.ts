import { Info } from '@opencode/schema/config'
import { Schema } from 'effect'
import type { OpenCodeConfigValidationIssue } from '../types'
import { isRecord } from '../utils/record'

export type OpenCodeConfigValidationResult =
  | { success: true }
  | { success: false; issues: OpenCodeConfigValidationIssue[] }

const standardSchema = Schema.toStandardSchemaV1(Info, {
  parseOptions: { errors: 'all', onExcessProperty: 'ignore' },
})

const LEGACY_SKILLS_MESSAGE =
  'skills must be a list of skill paths. Replace the legacy `skills: { paths: [...] }` object with `skills: [...]`.'

function toIssuePath(path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined): string {
  if (!path || path.length === 0) return 'root'
  return path
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.')
}

function hasLegacySkillsObject(value: unknown): boolean {
  return isRecord(value) && isRecord(value.skills)
}

/**
 * Validates a parsed OpenCode config document against the v2 `Config.Info` schema, ignoring
 * unknown keys so v1-only fields in existing files stay loadable. A legacy v1 `skills` object
 * is reported with an actionable message naming the v2 list form.
 */
export function validateOpenCodeConfig(value: unknown): OpenCodeConfigValidationResult {
  const result = standardSchema['~standard'].validate(value)
  if (result instanceof Promise) {
    throw new Error('OpenCode config validation must be synchronous')
  }
  if (!result.issues) return { success: true }
  const legacySkillsObject = hasLegacySkillsObject(value)
  return {
    success: false,
    issues: result.issues.map((issue) => {
      const path = toIssuePath(issue.path)
      const isLegacySkillsIssue = legacySkillsObject && path === 'skills'
      return {
        path,
        message: isLegacySkillsIssue ? LEGACY_SKILLS_MESSAGE : issue.message,
      }
    }),
  }
}
