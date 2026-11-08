import { z } from 'zod'
import { ChangeSourceSchema, DEFAULT_CHANGE_SOURCE } from './change-sources'

export const OUTPUT_LIMITS = {
  ID_MAX: 48,
  LABEL_MAX: 80,
  DESCRIPTION_MAX: 500,
  INSTRUCTIONS_MAX: 20000,
  TEMPLATE_HTML_MAX: 200000,
  DATA_SCHEMA_MAX_BYTES: 32768,
  DATA_SCHEMA_MAX_DEPTH: 8,
  DATA_MAX_BYTES: 1048576,
  PARAMS_MAX: 8,
  REFINE_MAX_CHARS: 4000,
  FRAME_MIN_HEIGHT: 160,
  FRAME_MAX_HEIGHT: 4000,
} as const

export const OUTPUT_GENERATION_TIMEOUT_MS = 15 * 60 * 1000

export const BUILTIN_OUTPUT_RENDERER_IDS = ['walkthrough'] as const

export type BuiltinOutputRendererId = (typeof BUILTIN_OUTPUT_RENDERER_IDS)[number]

export const OUTPUT_ICONS = [
  'BookOpen',
  'FileText',
  'ListChecks',
  'ShieldAlert',
  'Table',
  'BarChart3',
  'LayoutDashboard',
  'Sparkles',
  'GitCompare',
  'ClipboardList',
] as const

export const OutputDefinitionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(OUTPUT_LIMITS.ID_MAX)
  .regex(/^[a-z0-9][a-z0-9-]*$/)

const outputParamBaseFields = {
  name: z
    .string()
    .max(OUTPUT_LIMITS.ID_MAX)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1).max(OUTPUT_LIMITS.LABEL_MAX),
  required: z.boolean().optional(),
}

export const OutputParamFieldSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...outputParamBaseFields,
      type: z.literal('text'),
      maxLength: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      ...outputParamBaseFields,
      type: z.literal('number'),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .strict(),
  z
    .object({
      ...outputParamBaseFields,
      type: z.literal('select'),
      options: z
        .array(
          z
            .object({
              value: z.string().min(1).max(200),
              label: z.string().min(1).max(OUTPUT_LIMITS.LABEL_MAX),
            })
            .strict(),
        )
        .min(1)
        .max(50),
    })
    .strict(),
  z
    .object({
      ...outputParamBaseFields,
      type: z.literal('changeSource'),
    })
    .strict(),
])

export type OutputParamField = z.infer<typeof OutputParamFieldSchema>

type OutputDataSchemaDescription = { description?: string }

export type OutputDataObjectSchema = OutputDataSchemaDescription & {
  type: 'object'
  properties: Record<string, OutputDataSchema>
  required?: string[]
  additionalProperties?: false
}

export type OutputDataArraySchema = OutputDataSchemaDescription & {
  type: 'array'
  items: OutputDataSchema
  minItems?: number
  maxItems?: number
}

export type OutputDataStringSchema = OutputDataSchemaDescription & {
  type: 'string'
  maxLength?: number
  enum?: string[]
}

export type OutputDataNumberSchema = OutputDataSchemaDescription & {
  type: 'number'
  minimum?: number
  maximum?: number
}

export type OutputDataIntegerSchema = OutputDataSchemaDescription & {
  type: 'integer'
  minimum?: number
  maximum?: number
}

export type OutputDataBooleanSchema = OutputDataSchemaDescription & {
  type: 'boolean'
}

export type OutputDataSchema =
  | OutputDataObjectSchema
  | OutputDataArraySchema
  | OutputDataStringSchema
  | OutputDataNumberSchema
  | OutputDataIntegerSchema
  | OutputDataBooleanSchema

const outputDataSchemaDescriptionFields = {
  description: z.string().max(OUTPUT_LIMITS.DESCRIPTION_MAX).optional(),
}

export const OutputDataSchemaSchema: z.ZodType<OutputDataSchema> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        ...outputDataSchemaDescriptionFields,
        type: z.literal('object'),
        properties: z.record(z.string(), OutputDataSchemaSchema),
        required: z.array(z.string()).optional(),
        additionalProperties: z.literal(false).optional(),
      })
      .strict(),
    z
      .object({
        ...outputDataSchemaDescriptionFields,
        type: z.literal('array'),
        items: OutputDataSchemaSchema,
        minItems: z.number().int().nonnegative().optional(),
        maxItems: z.number().int().nonnegative().optional(),
      })
      .strict(),
    z
      .object({
        ...outputDataSchemaDescriptionFields,
        type: z.literal('string'),
        maxLength: z.number().int().positive().optional(),
        enum: z.array(z.string()).min(1).optional(),
      })
      .strict(),
    z
      .object({
        ...outputDataSchemaDescriptionFields,
        type: z.literal('number'),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
      })
      .strict(),
    z
      .object({
        ...outputDataSchemaDescriptionFields,
        type: z.literal('integer'),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
      })
      .strict(),
    z
      .object({
        ...outputDataSchemaDescriptionFields,
        type: z.literal('boolean'),
      })
      .strict(),
  ]),
)

export function buildOutputDataValidator(schema: OutputDataSchema): z.ZodType {
  switch (schema.type) {
    case 'object': {
      const shape: Record<string, z.ZodType> = {}
      for (const [name, child] of Object.entries(schema.properties)) {
        const childValidator = buildOutputDataValidator(child)
        shape[name] = schema.required?.includes(name) ? childValidator : childValidator.optional()
      }
      const objectValidator = z.object(shape)
      return schema.additionalProperties === false ? objectValidator.strict() : objectValidator
    }
    case 'array': {
      let validator = z.array(buildOutputDataValidator(schema.items))
      if (schema.minItems !== undefined) {
        validator = validator.min(schema.minItems)
      }
      if (schema.maxItems !== undefined) {
        validator = validator.max(schema.maxItems)
      }
      return validator
    }
    case 'string': {
      let validator = z.string()
      if (schema.maxLength !== undefined) {
        validator = validator.max(schema.maxLength)
      }
      if (schema.enum) {
        const enumValidator = z.enum(schema.enum as [string, ...string[]])
        if (schema.maxLength === undefined) {
          return enumValidator
        }
        const maxLength = schema.maxLength
        return enumValidator.refine((value) => value.length <= maxLength, {
          message: `String must contain at most ${maxLength} character(s)`,
        })
      }
      return validator
    }
    case 'number': {
      let validator = z.number()
      if (schema.minimum !== undefined) {
        validator = validator.min(schema.minimum)
      }
      if (schema.maximum !== undefined) {
        validator = validator.max(schema.maximum)
      }
      return validator
    }
    case 'integer': {
      let validator = z.number().int()
      if (schema.minimum !== undefined) {
        validator = validator.min(schema.minimum)
      }
      if (schema.maximum !== undefined) {
        validator = validator.max(schema.maximum)
      }
      return validator
    }
    case 'boolean':
      return z.boolean()
  }
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function outputDataSchemaDepth(schema: unknown): number {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return 0
  }
  const node = schema as Record<string, unknown>
  if (typeof node.type !== 'string') {
    return 0
  }
  let childDepth = 0
  if (node.type === 'object' && typeof node.properties === 'object' && node.properties !== null) {
    for (const child of Object.values(node.properties)) {
      childDepth = Math.max(childDepth, outputDataSchemaDepth(child))
    }
  } else if (node.type === 'array') {
    childDepth = outputDataSchemaDepth(node.items)
  }
  return childDepth + 1
}

function refineOutputDataSchemaLimits(schema: OutputDataSchema, ctx: z.RefinementCtx): void {
  if (utf8ByteLength(JSON.stringify(schema) ?? '') > OUTPUT_LIMITS.DATA_SCHEMA_MAX_BYTES) {
    ctx.addIssue({
      code: 'custom',
      path: ['dataSchema'],
      message: 'Output data schema exceeds the 32 KiB limit',
    })
  }
  if (outputDataSchemaDepth(schema) > OUTPUT_LIMITS.DATA_SCHEMA_MAX_DEPTH) {
    ctx.addIssue({
      code: 'custom',
      path: ['dataSchema'],
      message: `Output data schema exceeds the maximum depth of ${OUTPUT_LIMITS.DATA_SCHEMA_MAX_DEPTH}`,
    })
  }
}

export function validateOutputData(
  schema: OutputDataSchema,
  data: unknown,
): { ok: true; data: unknown } | { ok: false; message: string } {
  if (utf8ByteLength(JSON.stringify(data) ?? '') > OUTPUT_LIMITS.DATA_MAX_BYTES) {
    return { ok: false, message: 'Output data exceeds the 1 MiB limit' }
  }
  const result = buildOutputDataValidator(schema).safeParse(data)
  if (!result.success) {
    return { ok: false, message: z.prettifyError(result.error) }
  }
  return { ok: true, data: result.data }
}

export const OutputRendererSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('builtin'),
      id: z.enum(BUILTIN_OUTPUT_RENDERER_IDS),
    })
    .strict(),
  z
    .object({
      kind: z.literal('template'),
      html: z.string().min(1).max(OUTPUT_LIMITS.TEMPLATE_HTML_MAX),
    })
    .strict(),
  z
    .object({
      kind: z.literal('html'),
    })
    .strict(),
])

export type OutputRenderer = z.infer<typeof OutputRendererSchema>

const outputDefinitionFields = {
  id: OutputDefinitionIdSchema,
  label: z.string().min(1).max(OUTPUT_LIMITS.LABEL_MAX),
  description: z.string().max(OUTPUT_LIMITS.DESCRIPTION_MAX),
  icon: z.enum(OUTPUT_ICONS),
  params: z.array(OutputParamFieldSchema).max(OUTPUT_LIMITS.PARAMS_MAX).default([]),
  provider: z.literal('changes').optional(),
  instructions: z.string().min(1).max(OUTPUT_LIMITS.INSTRUCTIONS_MAX),
  dataSchema: OutputDataSchemaSchema.optional(),
  renderer: OutputRendererSchema,
  generation: z.enum(['separateSession', 'currentSession']),
}

type OutputDefinitionRefinementInput = {
  params: OutputParamField[]
  provider?: 'changes'
  dataSchema?: OutputDataSchema
  renderer: OutputRenderer
  origin?: 'builtin' | 'global' | 'session'
}

function refineOutputDefinition(value: OutputDefinitionRefinementInput, ctx: z.RefinementCtx): void {
  if (value.dataSchema) {
    refineOutputDataSchemaLimits(value.dataSchema, ctx)
  }
  if (value.renderer.kind !== 'html' && !value.dataSchema) {
    ctx.addIssue({ code: 'custom', message: 'Data schema is required for this renderer' })
  }
  if (value.provider === 'changes') {
    const changeSourceParams = value.params.filter((param) => param.type === 'changeSource')
    if (changeSourceParams.length !== 1) {
      ctx.addIssue({ code: 'custom', message: 'The changes provider requires exactly one changeSource parameter' })
    }
  }
  if (value.renderer.kind === 'builtin' && value.origin !== 'builtin') {
    ctx.addIssue({ code: 'custom', message: 'Builtin renderers require a builtin origin' })
  }
}

export const UserOutputDefinitionInputSchema = z
  .object(outputDefinitionFields)
  .superRefine((value, ctx) => refineOutputDefinition(value, ctx))

export type OutputDefinitionInput = z.infer<typeof UserOutputDefinitionInputSchema>

export const OutputDefinitionSchema = z
  .object({
    ...outputDefinitionFields,
    origin: z.enum(['builtin', 'global', 'session']),
  })
  .superRefine((value, ctx) => refineOutputDefinition(value, ctx))

export type OutputDefinition = z.infer<typeof OutputDefinitionSchema>

export type OutputIcon = (typeof OUTPUT_ICONS)[number]

export const OutputParamsSchema = z.record(z.string(), z.unknown())

export type OutputParams = z.infer<typeof OutputParamsSchema>

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

export function outputParamsKey(params: OutputParams): string {
  return JSON.stringify(sortJsonValue(params))
}

export function resolveOutputParams(
  definition: { params: OutputParamField[] },
  params: OutputParams = {},
): OutputParams {
  const resolved: OutputParams = {}
  for (const field of definition.params) {
    const raw = params[field.name]
    if (field.type === 'changeSource') {
      if (raw === undefined) {
        resolved[field.name] = DEFAULT_CHANGE_SOURCE
        continue
      }
      const parsed = ChangeSourceSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(`${field.label} is not a valid change source`)
      }
      resolved[field.name] = parsed.data
      continue
    }
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) {
        throw new Error(`${field.label} is required`)
      }
      continue
    }
    switch (field.type) {
      case 'text': {
        if (typeof raw !== 'string') {
          throw new Error(`${field.label} must be text`)
        }
        if (field.maxLength !== undefined && raw.length > field.maxLength) {
          throw new Error(`${field.label} must be at most ${field.maxLength} characters`)
        }
        resolved[field.name] = raw
        break
      }
      case 'number': {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          throw new Error(`${field.label} must be a number`)
        }
        if (field.min !== undefined && raw < field.min) {
          throw new Error(`${field.label} must be at least ${field.min}`)
        }
        if (field.max !== undefined && raw > field.max) {
          throw new Error(`${field.label} must be at most ${field.max}`)
        }
        resolved[field.name] = raw
        break
      }
      case 'select': {
        const option = field.options.find((candidate) => candidate.value === raw)
        if (!option) {
          const values = field.options.map((candidate) => candidate.value).join(', ')
          throw new Error(`${field.label} must be one of: ${values}`)
        }
        resolved[field.name] = raw
        break
      }
    }
  }
  return resolved
}

export const OutputStatusSchema = z.enum(['generating', 'ready', 'failed', 'cancelled'])

export type OutputStatus = z.infer<typeof OutputStatusSchema>

export const OutputGenerationErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
})

export type OutputGenerationError = z.infer<typeof OutputGenerationErrorSchema>

export const OutputRecordSchema = z.object({
  sessionId: z.string(),
  definitionId: OutputDefinitionIdSchema,
  paramsKey: z.string(),
  params: OutputParamsSchema,
  inputHash: z.string().nullable(),
  generatorSessionId: z.string().nullable(),
  status: OutputStatusSchema,
  outputDir: z.string().nullable(),
  publishedAt: z.number().nullable(),
  executionStartedAt: z.number().nullable(),
  error: OutputGenerationErrorSchema.nullable(),
  model: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type OutputRecord = z.infer<typeof OutputRecordSchema>

export const OutputStateSchema = z.object({
  definition: OutputDefinitionSchema,
  output: OutputRecordSchema.nullable(),
  currentInputHash: z.string().nullable(),
  hasInput: z.boolean(),
  stale: z.boolean(),
  generating: z.boolean(),
  running: z.boolean(),
  error: OutputGenerationErrorSchema.nullable(),
})

export type OutputState = z.infer<typeof OutputStateSchema>

export const GenerateOutputRequestSchema = z.object({
  definitionId: OutputDefinitionIdSchema,
  params: OutputParamsSchema.optional(),
  regenerate: z.boolean().optional(),
  model: z.string().trim().min(1).max(512).optional(),
})

export type GenerateOutputRequest = z.infer<typeof GenerateOutputRequestSchema>

export const RefineOutputRequestSchema = z.object({
  definitionId: OutputDefinitionIdSchema,
  params: OutputParamsSchema.optional(),
  text: z.string().trim().min(1).max(OUTPUT_LIMITS.REFINE_MAX_CHARS),
})

export type RefineOutputRequest = z.infer<typeof RefineOutputRequestSchema>

export const PromoteOutputDefinitionRequestSchema = z.object({
  sessionId: z.string().min(1),
  id: OutputDefinitionIdSchema,
  replace: z.boolean().optional(),
})

export type PromoteOutputDefinitionRequest = z.infer<typeof PromoteOutputDefinitionRequestSchema>

export const PublishOutputParamsSchema = z
  .object({
    definitionId: OutputDefinitionIdSchema.optional(),
    params: OutputParamsSchema.optional(),
    data: z.unknown(),
    path: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((value) => (value.data !== undefined) !== (value.path !== undefined), {
    message: 'Provide exactly one of data or path',
  })

export type PublishOutputParams = z.infer<typeof PublishOutputParamsSchema>

export const OpenOutputParamsSchema = z.object({
  definitionId: OutputDefinitionIdSchema,
  params: OutputParamsSchema.optional(),
})

export type OpenOutputParams = z.infer<typeof OpenOutputParamsSchema>

export const DefineOutputParamsSchema = z.object({
  definition: UserOutputDefinitionInputSchema,
})

export type DefineOutputParams = z.infer<typeof DefineOutputParamsSchema>

export const ReadOutputInputParamsSchema = z.object({
  file: z.string().trim().min(1).max(1000).optional(),
})

export type ReadOutputInputParams = z.infer<typeof ReadOutputInputParamsSchema>

export const OutputHostMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ui/initialize'),
    data: z.unknown(),
    theme: z.record(z.string(), z.string()),
  }),
  z.object({
    type: z.literal('ui/data'),
    data: z.unknown(),
  }),
])

export type OutputHostMessage = z.infer<typeof OutputHostMessageSchema>

export const OutputFrameMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ui/size'),
    height: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('ui/open-file'),
    path: z.string().min(1).max(1000),
    line: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('ui/refine'),
    text: z.string().min(1).max(OUTPUT_LIMITS.REFINE_MAX_CHARS),
  }),
])

export type OutputFrameMessage = z.infer<typeof OutputFrameMessageSchema>
