import { SSHHostKeyRequestSchema, type SSHHostKeyRequestEvent } from '@opencode-manager/shared/schemas'
import type { V2Event } from '@opencode-manager/shared/opencode'
import { JsonObjectSchema, JsonValueSchema, type JsonValue } from '@opencode-manager/shared/utils'
import { z } from 'zod'

const DurableV1Schema = z.looseObject({
  aggregateID: z.string(),
  seq: z.number(),
  version: z.literal(1),
})

const DurableV2Schema = z.looseObject({
  aggregateID: z.string(),
  seq: z.number(),
  version: z.literal(2),
})

const LocationPublicRefSchema = z.looseObject({ directory: z.string() })

const LocationRefSchema = z.looseObject({
  directory: z.string(),
  workspaceID: z.string().optional(),
})

const ModelRefSchema = z.looseObject({
  id: z.string(),
  providerID: z.string(),
  variant: z.string().optional(),
})

const TokenUsageInfoSchema = z.looseObject({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: z.looseObject({ read: z.number(), write: z.number() }),
})

const SessionStructuredErrorSchema = z.looseObject({
  type: z.string(),
  message: z.string(),
  status: z.number().optional(),
  response: z.looseObject({ body: z.string() }).optional(),
  retryAfterMs: z.number().optional(),
})

const SessionStatusSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('idle') }),
  z.looseObject({ type: z.literal('busy') }),
  z.looseObject({
    type: z.literal('retry'),
    attempt: z.number(),
    message: z.string(),
    next: z.number(),
    action: z
      .looseObject({
        reason: z.string(),
        provider: z.string(),
        title: z.string(),
        message: z.string(),
        label: z.string(),
        link: z.string().optional(),
      })
      .optional(),
  }),
])

const PermissionRuleSchema = z.looseObject({
  action: z.string(),
  resource: z.string(),
  effect: z.enum(['allow', 'deny', 'ask']),
})

const PermissionRulesetSchema = z.array(PermissionRuleSchema)

const PermissionReplySchema = z.enum(['once', 'always', 'reject'])

const PermissionSourceSchema = z.looseObject({
  type: z.literal('tool'),
  messageID: z.string(),
  id: z.string(),
})

const SessionInboxDeliverySchema = z.enum(['steer', 'queue'])

const PromptMentionSchema = z.looseObject({
  start: z.number(),
  end: z.number(),
  text: z.string(),
})

const PromptFileSourceSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('inline') }),
  z.looseObject({ type: z.literal('uri'), uri: z.string() }),
])

const PromptFileAttachmentSchema = z.looseObject({
  data: z.string(),
  mime: z.string(),
  source: PromptFileSourceSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  mention: PromptMentionSchema.optional(),
})

const PromptAgentAttachmentSchema = z.looseObject({
  name: z.string(),
  mention: PromptMentionSchema.optional(),
})

const PromptSkillAttachmentSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  text: z.string().optional(),
  mention: PromptMentionSchema.optional(),
})

const SessionInboxUserPayloadSchema = z.looseObject({
  text: z.string(),
  files: z.array(PromptFileAttachmentSchema).optional(),
  agents: z.array(PromptAgentAttachmentSchema).optional(),
  skills: z.array(PromptSkillAttachmentSchema).optional(),
  metadata: JsonObjectSchema.optional(),
})

const SessionInboxSyntheticPayloadSchema = z.looseObject({
  text: z.string(),
  description: z.string().optional(),
  metadata: JsonObjectSchema.optional(),
})

const SessionInboxMovePayloadSchema = z.looseObject({
  location: LocationRefSchema,
  projectID: z.string(),
  subpath: z.string().optional(),
})

const SessionInboxItemSchema = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('user'),
    payload: SessionInboxUserPayloadSchema,
    delivery: SessionInboxDeliverySchema,
  }),
  z.looseObject({
    type: z.literal('synthetic'),
    payload: SessionInboxSyntheticPayloadSchema,
    delivery: SessionInboxDeliverySchema,
  }),
  z.looseObject({
    type: z.literal('compaction'),
    payload: z.looseObject({}),
    delivery: SessionInboxDeliverySchema,
  }),
  z.looseObject({
    type: z.literal('move'),
    payload: SessionInboxMovePayloadSchema,
    delivery: SessionInboxDeliverySchema,
  }),
])

const SessionForkBoundarySchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('before'), messageID: z.string() }),
  z.looseObject({ type: z.literal('through'), messageID: z.string() }),
])

const InstructionEntrySnapshotSchema = z.array(
  z.looseObject({
    key: z.string(),
    value: JsonValueSchema,
    removed: z.boolean(),
  }),
)

const ProjectIconSchema = z.looseObject({
  url: z.string().optional(),
  override: z.string().optional(),
  color: z.string().optional(),
})

const ProjectCommandsSchema = z.looseObject({ start: z.string().optional() })

const ProjectTimeSchema = z.looseObject({
  created: z.number(),
  updated: z.number(),
  active: z.number(),
  archived: z.number().optional(),
})

const PtySchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  status: z.enum(['running', 'exited']),
  pid: z.number(),
  exitCode: z.number().optional(),
})

const PersistentPtyInfoSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  status: z.enum(['running', 'exited']),
  pid: z.number(),
  exitCode: z.number().optional(),
  sessionID: z.string(),
  userTitle: z.string().nullable(),
  foregroundProcess: z.string().nullable(),
  size: z.looseObject({ cols: z.number(), rows: z.number() }),
  output: z.looseObject({ head: z.number(), tail: z.number() }),
})

const ShellInfoSchema = z.looseObject({
  id: z.string(),
  status: z.enum(['running', 'exited', 'timeout', 'killed']),
  command: z.string(),
  cwd: z.string(),
  shell: z.string(),
  file: z.string(),
  pid: z.number().optional(),
  exit: z.number().optional(),
  signal: z.string().optional(),
  metadata: JsonObjectSchema,
  time: z.looseObject({ started: z.number(), completed: z.number().optional() }),
})

const ToolTextContentSchema = z.looseObject({
  type: z.literal('text'),
  text: z.string(),
})

const ToolFileContentSchema = z.looseObject({
  type: z.literal('file'),
  uri: z.string(),
  mime: z.string(),
  name: z.string().optional(),
})

const ToolContentSchema = z.discriminatedUnion('type', [
  ToolTextContentSchema,
  ToolFileContentSchema,
])

const FileDiffInfoSchema = z.looseObject({
  file: z.string(),
  patch: z.string(),
  additions: z.number(),
  deletions: z.number(),
  status: z.enum(['added', 'deleted', 'modified']),
  more: z.literal(true).optional(),
})

const SessionRevertSchema = z.looseObject({
  messageID: z.string(),
  partID: z.string().optional(),
  snapshot: z.string().optional(),
  files: z.array(FileDiffInfoSchema).optional(),
})

const FormOptionSchema = z.looseObject({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

const FormWhenSchema = z.looseObject({
  key: z.string(),
  op: z.enum(['eq', 'neq']),
  value: z.union([z.string(), z.number(), z.boolean()]),
})

const FormValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
])

const FormAnswerSchema = z.record(z.string(), FormValueSchema)

const formFieldBase = {
  key: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  when: z.array(FormWhenSchema).optional(),
}

const FormStringFieldSchema = z.looseObject({
  ...formFieldBase,
  type: z.literal('string'),
  format: z.enum(['email', 'uri', 'date', 'date-time']).optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  placeholder: z.string().optional(),
  default: z.string().optional(),
  options: z.array(FormOptionSchema).optional(),
  custom: z.boolean().optional(),
})

const FormNumberFieldSchema = z.looseObject({
  ...formFieldBase,
  type: z.literal('number'),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  default: z.number().optional(),
})

const FormIntegerFieldSchema = z.looseObject({
  ...formFieldBase,
  type: z.literal('integer'),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  default: z.number().optional(),
})

const FormBooleanFieldSchema = z.looseObject({
  ...formFieldBase,
  type: z.literal('boolean'),
  default: z.boolean().optional(),
})

const FormMultiselectFieldSchema = z.looseObject({
  ...formFieldBase,
  type: z.literal('multiselect'),
  options: z.array(FormOptionSchema),
  minItems: z.number().optional(),
  maxItems: z.number().optional(),
  custom: z.boolean().optional(),
  default: z.array(z.string()).optional(),
})

const FormExternalFieldSchema = z.looseObject({
  key: z.string(),
  type: z.literal('external'),
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
})

const FormFieldSchema = z.discriminatedUnion('type', [
  FormStringFieldSchema,
  FormNumberFieldSchema,
  FormIntegerFieldSchema,
  FormBooleanFieldSchema,
  FormMultiselectFieldSchema,
  FormExternalFieldSchema,
])

const FormInfoSchema = z.looseObject({
  id: z.string(),
  sessionID: z.string(),
  title: z.string(),
  metadata: JsonObjectSchema.optional(),
  fields: z.tuple([FormFieldSchema]).rest(FormFieldSchema),
})

const LocationShutdownSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('location.shutdown'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const ModelsDevRefreshedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('models-dev.refreshed'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const CredentialUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('credential.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const CredentialSwitchedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('credential.switched'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    integrationID: z.string(),
    credentialID: z.string().nullable(),
  }),
})

const IntegrationUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('integration.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const ProviderUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('provider.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const ModelUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('model.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const AgentUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('agent.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const SessionCreatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.created'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    projectID: z.string(),
    location: LocationRefSchema,
    subpath: z.string().optional(),
    parentID: z.string().optional(),
    slug: z.string(),
    title: z.string().optional(),
    agent: z.string().optional(),
    model: ModelRefSchema.optional(),
    metadata: JsonObjectSchema.optional(),
    permissions: PermissionRulesetSchema.optional(),
    version: z.string(),
  }),
})

const SessionAgentSelectedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.agent.selected'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    agent: z.string(),
    previous: z.string().optional(),
  }),
})

const SessionModelSelectedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.model.selected'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    model: ModelRefSchema,
    previous: ModelRefSchema.optional(),
  }),
})

const SessionMovedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.moved'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    location: LocationRefSchema,
    projectID: z.string(),
    subpath: z.string().optional(),
  }),
})

const SessionRenamedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.renamed'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    title: z.string(),
  }),
})

const SessionMetadataUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.metadata.updated'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    metadata: JsonObjectSchema,
  }),
})

const SessionPermissionsSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.permissions'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    permissions: PermissionRulesetSchema,
  }),
})

const SessionViewedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.viewed'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    idle: z.number(),
  }),
})

const SessionArchivedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.archived'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
  }),
})

const SessionUnarchivedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.unarchived'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
  }),
})

const SessionUsageUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.usage.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    cost: z.number(),
    tokens: TokenUsageInfoSchema,
  }),
})

const SessionDeletedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.deleted'),
  durable: DurableV2Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
  }),
})

const SessionForkedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.forked'),
  durable: DurableV2Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    parentID: z.string(),
    boundary: SessionForkBoundarySchema,
    instructions: z.record(z.string(), z.string()).optional(),
    instructionEntries: InstructionEntrySnapshotSchema.optional(),
  }),
})

const SessionInboxDeliveredSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.inbox.delivered'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    inboxID: z.string(),
  }),
})

const SessionInboxEnqueuedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.inbox.enqueued'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    inboxID: z.string(),
    item: SessionInboxItemSchema,
  }),
})

const SessionInboxCancelledSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.inbox.cancelled'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    inboxID: z.string(),
  }),
})

const SessionInboxDeliveryChangedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.inbox.delivery.changed'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    inboxID: z.string(),
    delivery: SessionInboxDeliverySchema,
  }),
})

const SessionExecutionStartedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.execution.started'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
  }),
})

const SessionExecutionSucceededSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.execution.succeeded'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
  }),
})

const SessionExecutionFailedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.execution.failed'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    error: SessionStructuredErrorSchema,
  }),
})

const SessionExecutionInterruptedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.execution.interrupted'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    reason: z.enum(['user', 'shutdown', 'superseded', 'inactivity']),
  }),
})

const SessionInstructionsUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.instructions.updated'),
  durable: DurableV2Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    delta: z.record(z.string(), z.string()),
    text: z.string().optional(),
  }),
})

const SessionSyntheticSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.synthetic'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    text: z.string(),
    description: z.string().optional(),
    metadata: JsonObjectSchema.optional(),
  }),
})

const SessionSkillActivatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.skill.activated'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    id: z.string(),
    name: z.string(),
    text: z.string(),
  }),
})

const SessionShellStartedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.shell.started'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    shell: ShellInfoSchema,
  }),
})

const SessionShellEndedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.shell.ended'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    shell: ShellInfoSchema,
    output: z.looseObject({
      output: z.string(),
      cursor: z.number(),
      size: z.number(),
      truncated: z.boolean(),
    }),
  }),
})

const SessionStepStartedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.step.started'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    agent: z.string(),
    model: ModelRefSchema,
    snapshot: z.string().optional(),
    started: z.number(),
  }),
})

const SessionStepStreamedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.step.streamed'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
  }),
})

const SessionStepEndedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.step.ended'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    finish: z.enum(['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']),
    rawFinish: z.string().optional(),
    native: JsonObjectSchema.optional(),
    cost: z.number(),
    tokens: TokenUsageInfoSchema,
    snapshot: z.string().optional(),
    files: z.array(z.string()).optional(),
  }),
})

const SessionStepFailedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.step.failed'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    error: SessionStructuredErrorSchema,
    finish: z.enum(['content-filter']).optional(),
    rawFinish: z.string().optional(),
    native: JsonObjectSchema.optional(),
    cost: z.number().optional(),
    tokens: TokenUsageInfoSchema.optional(),
    snapshot: z.string().optional(),
    files: z.array(z.string()).optional(),
  }),
})

const SessionTextStartedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.text.started'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    ordinal: z.number(),
  }),
})

const SessionTextDeltaSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.text.delta'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    ordinal: z.number(),
    delta: z.string(),
  }),
})

const SessionTextEndedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.text.ended'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    ordinal: z.number(),
    text: z.string(),
    native: JsonObjectSchema.optional(),
  }),
})

const SessionReasoningStartedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.reasoning.started'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    ordinal: z.number(),
    native: JsonObjectSchema.optional(),
  }),
})

const SessionReasoningDeltaSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.reasoning.delta'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    ordinal: z.number(),
    delta: z.string(),
  }),
})

const SessionReasoningEndedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.reasoning.ended'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    ordinal: z.number(),
    text: z.string(),
    native: JsonObjectSchema.optional(),
  }),
})

const SessionToolInputStartedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.tool.input.started'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    id: z.string(),
    name: z.string(),
  }),
})

const SessionToolInputDeltaSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.tool.input.delta'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    id: z.string(),
    delta: z.string(),
  }),
})

const SessionToolInputEndedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.tool.input.ended'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    id: z.string(),
    text: z.string(),
  }),
})

const SessionToolCalledSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.tool.called'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    id: z.string(),
    input: JsonObjectSchema,
    executed: z.boolean(),
    native: JsonObjectSchema.optional(),
  }),
})

const SessionToolProgressSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.tool.progress'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    id: z.string(),
    metadata: JsonObjectSchema,
  }),
})

const SessionToolSuccessSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.tool.success'),
  durable: DurableV2Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    id: z.string(),
    content: z.tuple([ToolContentSchema]).rest(ToolContentSchema),
    metadata: JsonObjectSchema.optional(),
    executed: z.boolean(),
    native: JsonObjectSchema.optional(),
  }),
})

const SessionToolFailedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.tool.failed'),
  durable: DurableV2Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    id: z.string(),
    error: SessionStructuredErrorSchema,
    content: z.tuple([ToolContentSchema]).rest(ToolContentSchema).optional(),
    metadata: JsonObjectSchema.optional(),
    executed: z.boolean(),
    native: JsonObjectSchema.optional(),
  }),
})

const SessionRetryScheduledSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.retry.scheduled'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    assistantMessageID: z.string(),
    attempt: z.number(),
    at: z.number(),
    error: SessionStructuredErrorSchema,
  }),
})

const SessionCompactionStartedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.compaction.started'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    reason: z.enum(['auto', 'manual']),
    inputID: z.string().optional(),
  }),
})

const SessionCompactionDeltaSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.compaction.delta'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    text: z.string(),
  }),
})

const SessionCompactionEndedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.compaction.ended'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    reason: z.enum(['auto', 'manual']),
    model: ModelRefSchema.optional(),
    native: JsonObjectSchema.optional(),
    text: z.string(),
    cost: z.number().optional(),
    tokens: TokenUsageInfoSchema.optional(),
  }),
})

const SessionCompactionFailedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.compaction.failed'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    reason: z.enum(['auto', 'manual']),
    error: SessionStructuredErrorSchema,
    inputID: z.string().optional(),
    cost: z.number().optional(),
    tokens: TokenUsageInfoSchema.optional(),
  }),
})

const SessionRevertStagedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.revert.staged'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    revert: SessionRevertSchema,
  }),
})

const SessionRevertClearedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.revert.cleared'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
  }),
})

const SessionRevertCommittedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.revert.committed'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    to: z.string(),
  }),
})

const FilesystemChangedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('filesystem.changed'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    file: z.string(),
    event: z.enum(['add', 'change', 'unlink']),
  }),
})

const ReferenceUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('reference.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const PermissionAskedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('permission.asked'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    id: z.string(),
    sessionID: z.string(),
    action: z.string(),
    resources: z.array(z.string()),
    save: z.array(z.string()).optional(),
    metadata: JsonObjectSchema.optional(),
    source: PermissionSourceSchema.optional(),
    message: z.string().optional(),
  }),
})

const PermissionRepliedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('permission.replied'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    requestID: z.string(),
    reply: PermissionReplySchema,
  }),
})

const PluginUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('plugin.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const ProjectUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('project.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    id: z.string(),
    canonical: z.string(),
    vcs: z.string().optional(),
    name: z.string().optional(),
    icon: ProjectIconSchema.optional(),
    commands: ProjectCommandsSchema.optional(),
    time: ProjectTimeSchema,
    sandboxes: z.array(z.string()),
  }),
})

const WorktreeUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('worktree.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    projectID: z.string(),
  }),
})

const WorktreeResolvedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('worktree.resolved'),
  durable: DurableV1Schema,
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    projectID: z.string(),
    directory: z.string(),
    previous: z.string(),
    adopted: z.array(z.string()).optional(),
  }),
})

const CommandUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('command.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const ConfigUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('config.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const SkillUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('skill.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const PtyCreatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('pty.created'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    info: PtySchema,
  }),
})

const PtyUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('pty.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    info: PtySchema,
  }),
})

const PtyExitedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('pty.exited'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    id: z.string(),
    exitCode: z.number(),
  }),
})

const PtyDeletedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('pty.deleted'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    id: z.string(),
  }),
})

const PersistentPtyAddedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('persistent-pty.added'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    terminal: PersistentPtyInfoSchema,
  }),
})

const PersistentPtyRemovedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('persistent-pty.removed'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    ptyID: z.string(),
  }),
})

const PersistentPtyUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('persistent-pty.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    terminal: PersistentPtyInfoSchema,
  }),
})

const ShellCreatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('shell.created'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    info: ShellInfoSchema,
  }),
})

const ShellExitedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('shell.exited'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    id: z.string(),
    exit: z.number().optional(),
    status: z.enum(['running', 'exited', 'timeout', 'killed']),
  }),
})

const ShellDeletedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('shell.deleted'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    id: z.string(),
  }),
})

const FormCreatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('form.created'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    form: FormInfoSchema,
  }),
})

const FormRepliedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('form.replied'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    id: z.string(),
    sessionID: z.string(),
    answer: FormAnswerSchema,
  }),
})

const FormCancelledSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('form.cancelled'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    id: z.string(),
    sessionID: z.string(),
  }),
})

const WebsearchUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('websearch.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const ArtifactUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('artifact.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({}),
})

const SessionStatusUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.status'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
    status: SessionStatusSchema,
  }),
})

const SessionIdleSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('session.idle'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
  }),
})

const TuiPromptAppendSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('tui.prompt.append'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    text: z.string(),
  }),
})

const TuiCommandExecuteSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('tui.command.execute'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    command: z.string(),
  }),
})

const TuiToastShowSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('tui.toast.show'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    title: z.string().optional(),
    message: z.string(),
    variant: z.enum(['info', 'success', 'warning', 'error']),
    duration: z.number().optional(),
  }),
})

const TuiSessionSelectSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('tui.session.select'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    sessionID: z.string(),
  }),
})

const InstallationUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('installation.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    version: z.string(),
  }),
})

const InstallationUpdateAvailableSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('installation.update-available'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    version: z.string(),
  }),
})

const VcsBranchUpdatedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('vcs.branch.updated'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    branch: z.string().optional(),
  }),
})

const McpStatusChangedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('mcp.status.changed'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    server: z.string(),
  }),
})

const McpResourcesChangedSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('mcp.resources.changed'),
  location: LocationRefSchema.optional(),
  data: z.looseObject({
    server: z.string(),
  }),
})

const V2EventRpcSchema = z.looseObject({
  id: z.string(),
  created: z.number(),
  metadata: JsonObjectSchema.optional(),
  type: z.templateLiteral(['rpc.', z.string()]),
  location: LocationPublicRefSchema,
  data: z.looseObject({}),
})

const V2EventServerConnectedSchema = z.looseObject({
  id: z.string(),
  metadata: JsonObjectSchema.optional(),
  type: z.literal('server.connected'),
  location: LocationPublicRefSchema.optional(),
  data: z.looseObject({}),
})

const V2EventLiteralSchema = z.discriminatedUnion('type', [
  LocationShutdownSchema, ModelsDevRefreshedSchema, CredentialUpdatedSchema, CredentialSwitchedSchema,
  IntegrationUpdatedSchema, ProviderUpdatedSchema, ModelUpdatedSchema, AgentUpdatedSchema,
  SessionCreatedSchema, SessionAgentSelectedSchema, SessionModelSelectedSchema, SessionMovedSchema,
  SessionRenamedSchema, SessionMetadataUpdatedSchema, SessionPermissionsSchema, SessionViewedSchema,
  SessionArchivedSchema, SessionUnarchivedSchema, SessionUsageUpdatedSchema, SessionDeletedSchema,
  SessionForkedSchema, SessionInboxDeliveredSchema, SessionInboxEnqueuedSchema, SessionInboxCancelledSchema,
  SessionInboxDeliveryChangedSchema, SessionExecutionStartedSchema, SessionExecutionSucceededSchema, SessionExecutionFailedSchema,
  SessionExecutionInterruptedSchema, SessionInstructionsUpdatedSchema, SessionSyntheticSchema, SessionSkillActivatedSchema,
  SessionShellStartedSchema, SessionShellEndedSchema, SessionStepStartedSchema, SessionStepStreamedSchema,
  SessionStepEndedSchema, SessionStepFailedSchema, SessionTextStartedSchema, SessionTextDeltaSchema,
  SessionTextEndedSchema, SessionReasoningStartedSchema, SessionReasoningDeltaSchema, SessionReasoningEndedSchema,
  SessionToolInputStartedSchema, SessionToolInputDeltaSchema, SessionToolInputEndedSchema, SessionToolCalledSchema,
  SessionToolProgressSchema, SessionToolSuccessSchema, SessionToolFailedSchema, SessionRetryScheduledSchema,
  SessionCompactionStartedSchema, SessionCompactionDeltaSchema, SessionCompactionEndedSchema, SessionCompactionFailedSchema,
  SessionRevertStagedSchema, SessionRevertClearedSchema, SessionRevertCommittedSchema, FilesystemChangedSchema,
  ReferenceUpdatedSchema, PermissionAskedSchema, PermissionRepliedSchema, PluginUpdatedSchema,
  ProjectUpdatedSchema, WorktreeUpdatedSchema, WorktreeResolvedSchema, CommandUpdatedSchema,
  ConfigUpdatedSchema, SkillUpdatedSchema, PtyCreatedSchema, PtyUpdatedSchema,
  PtyExitedSchema, PtyDeletedSchema, PersistentPtyAddedSchema, PersistentPtyRemovedSchema,
  PersistentPtyUpdatedSchema, ShellCreatedSchema, ShellExitedSchema, ShellDeletedSchema,
  FormCreatedSchema, FormRepliedSchema, FormCancelledSchema, WebsearchUpdatedSchema,
  ArtifactUpdatedSchema, SessionStatusUpdatedSchema, SessionIdleSchema, TuiPromptAppendSchema,
  TuiCommandExecuteSchema, TuiToastShowSchema, TuiSessionSelectSchema, InstallationUpdatedSchema,
  InstallationUpdateAvailableSchema, VcsBranchUpdatedSchema, McpStatusChangedSchema, McpResourcesChangedSchema,
  V2EventServerConnectedSchema,
])

export const V2EventSchema: z.ZodType<V2Event> = z.union([
  V2EventLiteralSchema,
  V2EventRpcSchema,
])

const SSHHostKeyRequestEventSchema = z.looseObject({
  type: z.literal('ssh.host-key-request'),
  properties: SSHHostKeyRequestSchema,
})

export const StreamEventPayloadSchema: z.ZodType<V2Event | SSHHostKeyRequestEvent> = z.union([
  V2EventSchema,
  SSHHostKeyRequestEventSchema,
])

export function parseStreamEventPayload(value: JsonValue): V2Event | SSHHostKeyRequestEvent | null {
  const parsed = StreamEventPayloadSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
