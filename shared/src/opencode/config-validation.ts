import { Info } from '@opencode/schema/config'
import { Schema } from 'effect'
import { z } from 'zod'
import type { OpenCodeConfigValidationIssue } from '../types'
import { JsonObjectSchema, type JsonValue } from '../utils/json'

export type OpenCodeConfigValidationResult =
  | { success: true }
  | { success: false; issues: OpenCodeConfigValidationIssue[] }

const standardSchema = Schema.toStandardSchemaV1(Info, {
  parseOptions: { errors: 'all', onExcessProperty: 'ignore' },
})

const LEGACY_SKILLS_MESSAGE =
  'skills must be a list of skill paths. Replace the legacy `skills: { paths: [...] }` object with `skills: [...]`.'

const IssuePathObjectSchema = z.object({ key: z.union([z.string(), z.number(), z.symbol()]) })

function toIssuePath(path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined): string {
  if (!path || path.length === 0) return 'root'
  return path
    .map((segment) => {
      const nested = IssuePathObjectSchema.safeParse(segment)
      return String(nested.success ? nested.data.key : segment)
    })
    .join('.')
}

function hasLegacySkillsObject(value: JsonValue | undefined): boolean {
  const root = JsonObjectSchema.safeParse(value)
  if (!root.success) return false
  return JsonObjectSchema.safeParse(root.data.skills).success
}

export function validateOpenCodeConfig(value: JsonValue | undefined): OpenCodeConfigValidationResult {
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
