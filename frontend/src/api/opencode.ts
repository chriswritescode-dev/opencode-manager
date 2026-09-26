import { openCodeLocation, parseOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import { callOpenCode } from './opencodeApi'
import type {
  AgentInfo,
  CommandInfo,
  FormAnswer,
  FormInfo,
  ModelRef,
  OpenCodeApi,
  PermissionRequest,
  SessionInboxCompaction,
  SessionInboxUser,
  SessionInfo,
  SessionMessageInfo,
  SessionRevert,
} from '@opencode-manager/shared/opencode'
import type { SessionSnapshot } from '@/lib/session-projection'

type SessionPromptInput = Parameters<OpenCodeApi['session']['prompt']>[0]

export type PromptFileInput = NonNullable<SessionPromptInput['files']>[number]

export type PromptAgentInput = NonNullable<SessionPromptInput['agents']>[number]

export type PromptSkillInput = NonNullable<SessionPromptInput['skills']>[number]

export type ActiveSessions = Awaited<ReturnType<OpenCodeApi['session']['active']>>

export interface SessionPage {
  items: SessionInfo[]
  nextCursor?: string
}

export interface SessionPageInput {
  directory: string
  limit?: number
  order?: 'asc' | 'desc'
  search?: string
  cursor?: string
}

export interface CreateSessionInput {
  directory: string
  title?: string
  agent?: string
  model?: string
}

export interface FindFilesInput {
  directory?: string
  query: string
  limit?: number
}

export interface SessionMessagesPage {
  messages: SessionMessageInfo[]
  nextCursor?: string
}

export interface SessionMessagesInput {
  cursor?: string
  limit?: number
}

export interface SendPromptInput {
  sessionID: string
  text: string
  files?: PromptFileInput[]
  agents?: PromptAgentInput[]
  skills?: PromptSkillInput[]
  delivery?: 'steer' | 'queue'
}

export type RunCommandInput = SendPromptInput & { name: string }

type PromptFields = Pick<SendPromptInput, 'text' | 'files' | 'agents' | 'skills' | 'delivery'>

function buildPromptFields(input: PromptFields) {
  return {
    text: input.text,
    ...(input.files ? { files: input.files } : {}),
    ...(input.agents ? { agents: input.agents } : {}),
    ...(input.skills ? { skills: input.skills } : {}),
    ...(input.delivery ? { delivery: input.delivery } : {}),
  }
}

export async function listSessionPage(input: SessionPageInput): Promise<SessionPage> {
  const { data, cursor } = await callOpenCode((api) =>
    api.session.list({
      directory: input.directory,
      parentID: 'null',
      limit: input.limit,
      order: input.order,
      search: input.search,
      cursor: input.cursor,
    }),
  )
  return { items: data, nextCursor: cursor.next ?? undefined }
}

export async function getSession(sessionID: string): Promise<SessionInfo> {
  return callOpenCode((api) => api.session.get({ sessionID }))
}

export async function createSession(input: CreateSessionInput): Promise<SessionInfo> {
  const model = input.model ? parseOpenCodeModelRef(input.model) : undefined
  return callOpenCode((api) =>
    api.session.create({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.agent !== undefined ? { agent: input.agent } : {}),
      ...(model ? { model } : {}),
      location: { directory: input.directory },
    }),
  )
}

export async function deleteSession(sessionID: string): Promise<void> {
  await callOpenCode((api) => api.session.remove({ sessionID }))
}

export async function renameSession(sessionID: string, title: string): Promise<void> {
  await callOpenCode((api) => api.session.update({ sessionID, title }))
}

export async function forkSession(sessionID: string, before?: string): Promise<SessionInfo> {
  return callOpenCode((api) =>
    api.session.fork({
      sessionID,
      ...(before ? { before } : {}),
    }),
  )
}

export async function switchSessionModel(sessionID: string, model: ModelRef): Promise<void> {
  await callOpenCode((api) => api.session.switchModel({ sessionID, model }))
}

export async function switchSessionAgent(sessionID: string, agent: string): Promise<void> {
  await callOpenCode((api) => api.session.switchAgent({ sessionID, agent }))
}

export async function sendPrompt(input: SendPromptInput): Promise<SessionInboxUser> {
  return callOpenCode((api) =>
    api.session.prompt({
      sessionID: input.sessionID,
      ...buildPromptFields(input),
    }),
  )
}

export async function runCommand(input: RunCommandInput): Promise<void> {
  await callOpenCode((api) =>
    api.session.command({
      sessionID: input.sessionID,
      name: input.name,
      ...buildPromptFields(input),
    }),
  )
}

export async function runShell(sessionID: string, command: string): Promise<void> {
  await callOpenCode((api) => api.session.shell({ sessionID, command }))
}

export async function interruptSession(sessionID: string): Promise<void> {
  await callOpenCode((api) => api.session.interrupt({ sessionID }))
}

export async function stageRevert(sessionID: string, messageID: string): Promise<SessionRevert> {
  return callOpenCode((api) => api.session.revert.stage({ sessionID, messageID }))
}

export async function commitRevert(sessionID: string): Promise<void> {
  await callOpenCode((api) => api.session.revert.commit({ sessionID }))
}

export async function clearRevert(sessionID: string): Promise<void> {
  await callOpenCode((api) => api.session.revert.clear({ sessionID }))
}

export async function compactSession(sessionID: string): Promise<SessionInboxCompaction> {
  return callOpenCode((api) => api.session.compact({ sessionID }))
}

export async function activateSkill(sessionID: string, id: string): Promise<void> {
  await callOpenCode((api) => api.session.skill({ sessionID, id }))
}

export async function listActiveSessions(): Promise<ActiveSessions> {
  return callOpenCode((api) => api.session.active())
}

export async function listAgents(directory?: string): Promise<AgentInfo[]> {
  const { data } = await callOpenCode((api) => api.agent.list(openCodeLocation(directory)))
  return data
}

export async function listCommands(directory?: string): Promise<CommandInfo[]> {
  const { data } = await callOpenCode((api) => api.command.list(openCodeLocation(directory)))
  return data
}

export async function listPendingPermissions(directory: string): Promise<PermissionRequest[]> {
  const { data } = await callOpenCode((api) => api.permission.request.list(openCodeLocation(directory)))
  return data
}

export async function replyPermission(
  sessionID: string,
  requestID: string,
  decision: 'once' | 'always' | 'reject',
  message?: string,
): Promise<void> {
  await callOpenCode((api) =>
    api.permission.reply({
      sessionID,
      requestID,
      decision,
      ...(message ? { message } : {}),
    }),
  )
}

export async function listPendingForms(directory: string): Promise<FormInfo[]> {
  const { data } = await callOpenCode((api) => api.form.list(openCodeLocation(directory)))
  return data
}

export async function replyForm(sessionID: string, formID: string, answer: FormAnswer): Promise<void> {
  await callOpenCode((api) => api.session.form.reply({ sessionID, formID, answer }))
}

export async function cancelForm(sessionID: string, formID: string): Promise<void> {
  await callOpenCode((api) => api.session.form.cancel({ sessionID, formID }))
}

export async function findFiles(input: FindFilesInput): Promise<string[]> {
  const { data } = await callOpenCode((api) =>
    api.file.find({
      ...openCodeLocation(input.directory),
      query: input.query,
      type: 'file',
      limit: input.limit,
    }),
  )
  return data.map((entry) => entry.path)
}

export async function listSessionMessages(
  sessionID: string,
  input: SessionMessagesInput = {},
): Promise<SessionMessagesPage> {
  const { data, cursor } = await callOpenCode((api) =>
    api.message.list({
      sessionID,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.cursor === undefined ? { order: 'desc' as const } : { cursor: input.cursor }),
    }),
  )
  return { messages: [...data].reverse(), nextCursor: cursor.next ?? undefined }
}

export async function readSessionSnapshot(sessionID: string): Promise<SessionSnapshot> {
  const [page, pending, active] = await Promise.all([
    listSessionMessages(sessionID),
    callOpenCode((api) => api.session.inbox.list({ sessionID })),
    listActiveSessions(),
  ])
  return {
    messages: page.messages,
    nextCursor: page.nextCursor,
    pending,
    status: active[sessionID] ? 'busy' : 'idle',
  }
}
