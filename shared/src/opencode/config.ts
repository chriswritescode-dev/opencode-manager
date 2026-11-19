import type { ConfigEntry } from '@opencode/client'
import { z } from 'zod'
import { JsonObjectSchema, JsonValueSchema } from '../utils/json'

export type OpenCodeConfigInfo = Extract<ConfigEntry, { type: 'document' }>['info']

export type OpenCodeAgentConfig = NonNullable<OpenCodeConfigInfo['agents']>[string]

export type OpenCodeCommandConfig = NonNullable<OpenCodeConfigInfo['commands']>[string]

export type OpenCodeProviderConfig = NonNullable<OpenCodeConfigInfo['providers']>[string]

export type OpenCodeProviderModelConfig = NonNullable<OpenCodeProviderConfig['models']>[string]

export type OpenCodePermissionRule = NonNullable<OpenCodeConfigInfo['permissions']>[number]

type ProviderSettings = NonNullable<OpenCodeProviderConfig['settings']>

type ProviderModelSettings = NonNullable<OpenCodeProviderModelConfig['settings']>

type ProviderModelCompatibility = NonNullable<OpenCodeProviderModelConfig['compatibility']>

type ProviderCompatibility = NonNullable<OpenCodeProviderConfig['compatibility']>

type ProviderModelCapabilities = NonNullable<OpenCodeProviderModelConfig['capabilities']>

type ProviderModelCost = NonNullable<OpenCodeProviderModelConfig['cost']>

type ProviderModelLimit = NonNullable<OpenCodeProviderModelConfig['limit']>

type ProviderModelVariant = NonNullable<OpenCodeProviderModelConfig['variants']>[number]

type ProviderModelVariantSettings = NonNullable<ProviderModelVariant['settings']>

const JsonValueOrNullSchema = z.union([JsonValueSchema, z.null()])

const modelRefSchema = z.object({
  providerID: z.string(),
  model: z.string(),
  variant: z.string().optional(),
})

const modelRefOrStringSchema = z.union([z.string(), modelRefSchema])

const timeoutSchema = z.union([z.number(), z.literal(false)])

const providerCompactionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('summary') }),
  z.object({ type: z.literal('native') }),
])

const providerCacheSchema = z.object({
  ttl: z.templateLiteral([z.number(), z.enum(['ms', 's', 'm', 'h', 'd'])]).optional(),
})

const providerEncodingSchema = z.enum(['zstd', 'gzip', 'none'])

const providerSettingsSchema: z.ZodType<ProviderSettings> = z
  .object({
    timeout: timeoutSchema.optional(),
    headerTimeout: timeoutSchema.optional(),
    chunkTimeout: timeoutSchema.optional(),
    compaction: providerCompactionSchema.optional(),
    cache: providerCacheSchema.optional(),
    transport: z.enum(['http', 'websocket']).optional(),
    encoding: providerEncodingSchema.optional(),
  })
  .catchall(JsonValueOrNullSchema)

const providerModelSettingsSchema: z.ZodType<ProviderModelSettings> = z
  .object({
    compaction: providerCompactionSchema.optional(),
    cache: providerCacheSchema.optional(),
    encoding: providerEncodingSchema.optional(),
  })
  .catchall(JsonValueOrNullSchema)

const providerModelVariantSettingsSchema: z.ZodType<ProviderModelVariantSettings> = z
  .object({
    compaction: providerCompactionSchema.optional(),
    encoding: providerEncodingSchema.optional(),
  })
  .catchall(JsonValueOrNullSchema)

const providerCompatibilityFields = {
  reasoningField: z.string().optional(),
  requireReasoning: z.boolean().optional(),
  maxTokensField: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
  requireFinishReason: z.boolean().optional(),
  requireAssistantAfterTool: z.boolean().optional(),
  supportsPromptCacheKey: z.boolean().optional(),
  streamUsage: z.boolean().optional(),
  cacheFormat: z.enum(['anthropic', 'alibaba']).optional(),
  mediaInput: z.enum(['assets', 'state', 'root']).optional(),
}

const providerCompatibilitySchema: z.ZodType<ProviderCompatibility> = z.object(providerCompatibilityFields).catchall(JsonValueSchema)

const providerModelCompatibilitySchema: z.ZodType<ProviderModelCompatibility> = z.object({
  ...providerCompatibilityFields,
  supportsThinkingBlockBinding: z.boolean().optional(),
  supportsEffortUpdates: z.boolean().optional(),
}).catchall(JsonValueSchema)

const modelBudgetSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
})

const providerModelReasoningSchema: z.ZodType<ProviderModelCapabilities['reasoning']> = z.union([
  z.object({ supported: z.literal(false) }).catchall(JsonValueSchema),
  z.object({
    supported: z.literal(true),
    toggle: z.boolean().optional(),
    effort: z.array(z.string()).optional(),
    budget: modelBudgetSchema.optional(),
  }).catchall(JsonValueSchema),
])

const providerModelCapabilitiesSchema: z.ZodType<ProviderModelCapabilities> = z.object({
  tools: z.boolean().optional(),
  input: z.array(z.string()).optional(),
  output: z.array(z.string()).optional(),
  temperature: z.boolean().optional(),
  reasoning: providerModelReasoningSchema.optional(),
}).catchall(JsonValueSchema)

const providerModelCostEntrySchema = z.object({
  tier: z.object({ type: z.literal('context'), size: z.number() }).optional(),
  input: z.number(),
  output: z.number(),
  cache: z.object({
    read: z.number().optional(),
    write: z.number().optional(),
  }).optional(),
}).catchall(JsonValueSchema)

const providerModelCostSchema: z.ZodType<ProviderModelCost> = z.union([
  providerModelCostEntrySchema,
  z.array(providerModelCostEntrySchema),
])

const providerModelLimitSchema: z.ZodType<ProviderModelLimit> = z.object({
  context: z.number().optional(),
  input: z.number().optional(),
  output: z.number().optional(),
}).catchall(JsonValueSchema)

const providerModelVariantSchema: z.ZodType<ProviderModelVariant> = z.object({
  id: z.string(),
  settings: providerModelVariantSettingsSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: JsonObjectSchema.optional(),
})

export const OpenCodeProviderModelConfigSchema: z.ZodType<OpenCodeProviderModelConfig> = z.object({
  modelID: z.string().optional(),
  type: z.string().optional(),
  family: z.string().optional(),
  name: z.string().optional(),
  releaseDate: z.string().optional(),
  compatibility: providerModelCompatibilitySchema.optional(),
  package: z.string().optional(),
  settings: providerModelSettingsSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: JsonObjectSchema.optional(),
  capabilities: providerModelCapabilitiesSchema.optional(),
  variants: z.array(providerModelVariantSchema).optional(),
  cost: providerModelCostSchema.optional(),
  disabled: z.boolean().optional(),
  limit: providerModelLimitSchema.optional(),
}).catchall(JsonValueSchema)

export const OpenCodeProviderConfigSchema: z.ZodType<OpenCodeProviderConfig> = z.object({
  canonical: z.string().optional(),
  name: z.string().optional(),
  env: z.array(z.string()).optional(),
  package: z.string().optional(),
  compatibility: providerCompatibilitySchema.optional(),
  settings: providerSettingsSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: JsonObjectSchema.optional(),
  models: z.record(z.string(), OpenCodeProviderModelConfigSchema).optional(),
}).catchall(JsonValueSchema)

export const OpenCodeCommandConfigSchema: z.ZodType<OpenCodeCommandConfig> = z.object({
  template: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: modelRefOrStringSchema.optional(),
  subagent: z.boolean().optional(),
  subtask: z.boolean().optional(),
}).catchall(JsonValueSchema)

export const OpenCodePermissionRuleSchema: z.ZodType<OpenCodePermissionRule> = z.object({
  action: z.string(),
  resource: z.string(),
  effect: z.enum(['allow', 'deny', 'ask']),
})

export const OpenCodeAgentConfigSchema: z.ZodType<OpenCodeAgentConfig> = z.object({
  model: modelRefOrStringSchema.optional(),
  request: z.object({
    headers: z.record(z.string(), z.string()).optional(),
    body: JsonObjectSchema.optional(),
  }).catchall(JsonValueSchema).optional(),
  system: z.string().optional(),
  description: z.string().optional(),
  mode: z.enum(['subagent', 'primary', 'all']).optional(),
  hidden: z.boolean().optional(),
  color: z.string().optional(),
  steps: z.number().optional(),
  disabled: z.boolean().optional(),
  permissions: z.array(OpenCodePermissionRuleSchema).optional(),
}).catchall(JsonValueSchema)

export const OpenCodeManagedConfigSectionsSchema = z.object({
  agents: z.record(z.string(), OpenCodeAgentConfigSchema).optional(),
  commands: z.record(z.string(), OpenCodeCommandConfigSchema).optional(),
  providers: z.record(z.string(), OpenCodeProviderConfigSchema).optional(),
  mcp: JsonValueSchema.optional(),
})

export type OpenCodeManagedConfigSections = z.infer<typeof OpenCodeManagedConfigSectionsSchema>
