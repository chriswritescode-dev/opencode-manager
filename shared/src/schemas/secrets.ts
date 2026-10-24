import { z } from 'zod'
import { BLOCKED_SERVER_ENV_KEYS } from './settings'

export const SecretKindSchema = z.enum(['secret', 'variable'])

export type SecretKind = z.infer<typeof SecretKindSchema>

export const SECRET_VALUE_MAX_BYTES = 48 * 1024

export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const RESERVED_ENV_PREFIXES = ['OCM_', 'OPENCODE_', 'GIT_CONFIG_', 'MSB_', 'LD_'] as const

/**
 * Prefixes the sandbox owns: a plan-provided or forwarded variable using one of
 * them could replace the sandbox control variables, so they never cross into a
 * microVM from a plan.
 */
export const SANDBOX_CONTROL_ENV_PREFIXES = ['OCM_', 'MSB_'] as const satisfies readonly (typeof RESERVED_ENV_PREFIXES)[number][]

const RESERVED_ENV_NAMES = ['PATH', 'HOME', 'NODE_OPTIONS'] as const

const BLOCKED_ENV_NAMES = new Set<string>(BLOCKED_SERVER_ENV_KEYS)

export function isReservedEnvName(name: string): boolean {
  const normalized = name.toUpperCase()
  if (BLOCKED_ENV_NAMES.has(normalized)) return true
  if ((RESERVED_ENV_NAMES as readonly string[]).includes(normalized)) return true
  return RESERVED_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export const SecretNameSchema = z
  .string()
  .max(255, 'Name must be at most 255 characters')
  .regex(
    ENV_NAME_PATTERN,
    'Name must start with a letter or underscore and contain only letters, numbers, and underscores',
  )
  .refine((name) => !name.toUpperCase().startsWith('GITHUB_'), 'Name must not start with GITHUB_')
  .refine((name) => !isReservedEnvName(name), 'Name is reserved for Manager or the runtime')
  .transform((name) => name.toUpperCase())

export type SecretName = z.infer<typeof SecretNameSchema>

export const EnvironmentNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_.-]{1,64}$/,
    'Environment name must be 1-64 characters of letters, numbers, dots, underscores, or hyphens',
  )
  .transform((name) => name.toLowerCase())

export type EnvironmentName = z.infer<typeof EnvironmentNameSchema>

const textEncoder = new TextEncoder()

export const SecretValueSchema = z
  .string()
  .min(1, 'Value must not be empty')
  .refine(
    (value) => textEncoder.encode(value).length <= SECRET_VALUE_MAX_BYTES,
    `Value must be at most ${SECRET_VALUE_MAX_BYTES} bytes`,
  )

export const SetSecretRequestSchema = z.object({
  value: SecretValueSchema,
  environment: EnvironmentNameSchema.optional(),
})

export type SetSecretRequest = z.infer<typeof SetSecretRequestSchema>

export const SecretEntrySchema = z.object({
  name: z.string(),
  environment: z.string().nullable(),
  updatedAt: z.number(),
  value: z.string().optional(),
})

export type SecretEntry = z.infer<typeof SecretEntrySchema>

export const SecretListResponseSchema = z.object({
  items: z.array(SecretEntrySchema),
})

export type SecretListResponse = z.infer<typeof SecretListResponseSchema>
