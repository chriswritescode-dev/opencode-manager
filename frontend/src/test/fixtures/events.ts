import type {
  FormInfo,
  GoalState,
  PermissionReply,
  PermissionRequest,
  SessionStatus,
} from '@opencode-manager/shared/opencode'
import type { SSHHostKeyRequest } from '@opencode-manager/shared/schemas'
import type { JsonObject } from '@opencode-manager/shared/utils'

export interface StreamEventContext {
  directory?: string
  serverId?: string
}

export interface ProviderShellInfo {
  id: string
  status: 'running' | 'exited' | 'timeout' | 'killed'
  sessionID: string
}

export type SimpleStreamEventType =
  | 'credential.updated'
  | 'credential.switched'
  | 'integration.updated'
  | 'provider.updated'
  | 'model.updated'
  | 'agent.updated'
  | 'command.updated'
  | 'skill.updated'
  | 'config.updated'

let eventSequence = 0

function nextSequence(): number {
  eventSequence += 1
  return eventSequence
}

function durable(version: 1 | 2): JsonObject {
  return { aggregateID: 'aggregate_1', seq: nextSequence(), version }
}

function withContext(payload: JsonObject, context: StreamEventContext): JsonObject {
  if (context.directory !== undefined) payload.directory = context.directory
  if (context.serverId !== undefined) payload.serverId = context.serverId
  return payload
}

function streamEvent(
  type: string,
  data: JsonObject,
  context: StreamEventContext = {},
  options: { durableVersion?: 1 | 2 } = {},
): JsonObject {
  const payload: JsonObject = { id: `evt_${nextSequence()}`, created: 1, type, data }
  if (options.durableVersion) payload.durable = durable(options.durableVersion)
  return withContext(payload, context)
}

function toolSource(permission: PermissionRequest): JsonObject | undefined {
  const source = permission.source
  if (!source) return undefined
  return { type: 'tool', messageID: source.messageID, id: source.id }
}

export function permissionAsked(
  permission: PermissionRequest,
  context: StreamEventContext = {},
): JsonObject {
  const data: JsonObject = {
    id: permission.id,
    sessionID: permission.sessionID,
    action: permission.action,
    resources: permission.resources,
  }
  if (permission.metadata) data.metadata = permission.metadata
  const source = toolSource(permission)
  if (source) data.source = source
  return streamEvent('permission.asked', data, context)
}

export function permissionReplied(
  sessionID: string,
  requestID: string,
  reply: PermissionReply,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('permission.replied', { sessionID, requestID, reply }, context)
}

export function formCreated(form: FormInfo, context: StreamEventContext = {}): JsonObject {
  return streamEvent('form.created', { form }, context)
}

export function formReplied(
  id: string,
  sessionID: string,
  answer: JsonObject,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('form.replied', { id, sessionID, answer }, context)
}

export function formCancelled(
  id: string,
  sessionID: string,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('form.cancelled', { id, sessionID }, context)
}

export function sessionCreated(
  sessionID: string,
  context: StreamEventContext = {},
  session: { parentID?: string } = {},
): JsonObject {
  const data: JsonObject = {
    sessionID,
    projectID: 'project_1',
    location: { directory: context.directory ?? '/' },
    slug: sessionID,
    version: '2.0.0',
  }
  if (session.parentID) data.parentID = session.parentID
  return streamEvent('session.created', data, context, { durableVersion: 1 })
}

export function sessionRenamed(
  sessionID: string,
  title: string,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('session.renamed', { sessionID, title }, context, { durableVersion: 1 })
}

export function sessionDeleted(sessionID: string, context: StreamEventContext = {}): JsonObject {
  return streamEvent('session.deleted', { sessionID }, context, { durableVersion: 2 })
}

export function sessionMoved(
  sessionID: string,
  directory: string,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent(
    'session.moved',
    { sessionID, projectID: 'project_1', location: { directory } },
    context,
    { durableVersion: 1 },
  )
}

export function sessionModelSelected(
  sessionID: string,
  model: { providerID: string, id: string, variant?: string },
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('session.model.selected', { sessionID, model }, context, { durableVersion: 1 })
}

export function sessionAgentSelected(
  sessionID: string,
  agent: string,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('session.agent.selected', { sessionID, agent }, context, { durableVersion: 1 })
}

export function sessionForked(
  sessionID: string,
  parentID: string,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent(
    'session.forked',
    { sessionID, parentID, boundary: { type: 'before', messageID: 'msg_0' } },
    context,
    { durableVersion: 2 },
  )
}

export function sessionUsageUpdated(
  sessionID: string,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent(
    'session.usage.updated',
    { sessionID, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    context,
  )
}

export function sessionExecutionStarted(
  sessionID: string,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('session.execution.started', { sessionID }, context, { durableVersion: 1 })
}

export function sessionExecutionSucceeded(
  sessionID: string,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('session.execution.succeeded', { sessionID }, context, { durableVersion: 1 })
}

export function sessionExecutionFailed(
  sessionID: string,
  message = 'boom',
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent(
    'session.execution.failed',
    { sessionID, error: { type: 'execution.failed', message } },
    context,
    { durableVersion: 1 },
  )
}

export function sessionExecutionInterrupted(
  sessionID: string,
  reason: 'user' | 'shutdown' | 'superseded' | 'inactivity' = 'user',
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('session.execution.interrupted', { sessionID, reason }, context, { durableVersion: 1 })
}

export function sessionCompactionStarted(
  sessionID: string,
  reason: 'auto' | 'manual',
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('session.compaction.started', { sessionID, reason }, context, { durableVersion: 1 })
}

export function sessionCompactionEnded(
  sessionID: string,
  reason: 'auto' | 'manual',
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent(
    'session.compaction.ended',
    { sessionID, reason, text: 'summary' },
    context,
    { durableVersion: 1 },
  )
}

export function sessionCompactionFailed(
  sessionID: string,
  reason: 'auto' | 'manual',
  message = 'boom',
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent(
    'session.compaction.failed',
    { sessionID, reason, error: { type: 'compaction.failed', message } },
    context,
    { durableVersion: 1 },
  )
}

export function sessionStatusUpdated(
  sessionID: string,
  status: SessionStatus,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('session.status', { sessionID, status }, context)
}

export function sessionIdle(sessionID: string, context: StreamEventContext = {}): JsonObject {
  return streamEvent('session.idle', { sessionID }, context)
}

export function shellCreated(shell: ProviderShellInfo, context: StreamEventContext = {}): JsonObject {
  return streamEvent(
    'shell.created',
    {
      info: {
        id: shell.id,
        status: shell.status,
        command: 'echo hello',
        cwd: '/repo',
        shell: 'bash',
        file: '/tmp/shell.log',
        metadata: { sessionID: shell.sessionID },
        time: { started: 1 },
      },
    },
    context,
  )
}

export function shellExited(
  id: string,
  status: 'exited' | 'timeout' | 'killed' = 'exited',
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent('shell.exited', { id, status }, context)
}

export function shellDeleted(id: string, context: StreamEventContext = {}): JsonObject {
  return streamEvent('shell.deleted', { id }, context)
}

export function simpleStreamEvent(
  type: SimpleStreamEventType,
  context: StreamEventContext = {},
): JsonObject {
  return streamEvent(type, {}, context)
}

export function vcsBranchUpdated(branch: string, context: StreamEventContext = {}): JsonObject {
  return streamEvent('vcs.branch.updated', { branch }, context)
}

export function goalChanged(
  sessionID: string,
  goal: GoalState,
  context: StreamEventContext = {},
): JsonObject {
  const payload: JsonObject = {
    id: `evt_${nextSequence()}`,
    created: 1,
    type: 'rpc.opencode.goal.changed',
    location: { directory: context.directory ?? '/' },
    data: { sessionID, goal },
  }
  return withContext(payload, context)
}

export function sshHostKeyRequest(properties: SSHHostKeyRequest): JsonObject {
  return { type: 'ssh.host-key-request', properties }
}
