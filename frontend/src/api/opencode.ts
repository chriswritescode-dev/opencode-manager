import { openCodeApi, toFetchError } from './opencodeApi'
import type {
  CommandInfo,
  FormAnswer,
  FormInfo,
  ModelRef,
  PermissionRequest,
  PromptMention,
  SessionInboxCompaction,
  SessionInboxUser,
  SessionInfo,
  SessionMessageInfo,
  SessionRevert,
} from '@opencode-manager/shared/opencode'
import type { SessionSnapshot } from '@/lib/session-projection'

export interface PromptFileInput {
  uri: string
  name?: string
  description?: string
  mention?: PromptMention
}

export interface PromptAgentInput {
  name: string
  mention?: PromptMention
}

export interface PromptSkillInput {
  id: string
  mention?: PromptMention
}

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
  directory?: string
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

export interface RunCommandInput {
  sessionID: string
  name: string
  text: string
  files?: PromptFileInput[]
  agents?: PromptAgentInput[]
  skills?: PromptSkillInput[]
  delivery?: 'steer' | 'queue'
}

export function parseModelRef(model: string): ModelRef | undefined {
  const [providerID, ...rest] = model.split('/')
  const [id, variant] = rest.join('/').split('#')
  if (!providerID || !id) return undefined
  return { providerID, id, ...(variant ? { variant } : {}) }
}

export async function listSessionPage(input: SessionPageInput): Promise<SessionPage> {
  try {
    const { data, cursor } = await openCodeApi.session.list({
      directory: input.directory,
      parentID: 'null',
      limit: input.limit,
      order: input.order,
      search: input.search,
      cursor: input.cursor,
    })
    return { items: data, nextCursor: cursor.next ?? undefined }
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function getSession(sessionID: string): Promise<SessionInfo> {
  try {
    return await openCodeApi.session.get({ sessionID })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function createSession(input: CreateSessionInput): Promise<SessionInfo> {
  const model = input.model ? parseModelRef(input.model) : undefined
  try {
    return await openCodeApi.session.create({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.agent !== undefined ? { agent: input.agent } : {}),
      ...(model ? { model } : {}),
      ...(input.directory ? { location: { directory: input.directory } } : {}),
    })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function deleteSession(sessionID: string): Promise<void> {
  try {
    await openCodeApi.session.remove({ sessionID })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function renameSession(sessionID: string, title: string): Promise<void> {
  try {
    await openCodeApi.session.update({ sessionID, title })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function forkSession(sessionID: string, before?: string): Promise<SessionInfo> {
  try {
    return await openCodeApi.session.fork({
      sessionID,
      ...(before ? { before } : {}),
    })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function switchSessionModel(sessionID: string, model: ModelRef): Promise<void> {
  try {
    await openCodeApi.session.switchModel({ sessionID, model })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function switchSessionAgent(sessionID: string, agent: string): Promise<void> {
  try {
    await openCodeApi.session.switchAgent({ sessionID, agent })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function sendPrompt(input: SendPromptInput): Promise<SessionInboxUser> {
  try {
    return await openCodeApi.session.prompt({
      sessionID: input.sessionID,
      text: input.text,
      ...(input.files ? { files: input.files } : {}),
      ...(input.agents ? { agents: input.agents } : {}),
      ...(input.skills ? { skills: input.skills } : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
    })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function runCommand(input: RunCommandInput): Promise<void> {
  try {
    await openCodeApi.session.command({
      sessionID: input.sessionID,
      name: input.name,
      text: input.text,
      ...(input.files ? { files: input.files } : {}),
      ...(input.agents ? { agents: input.agents } : {}),
      ...(input.skills ? { skills: input.skills } : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
    })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function runShell(sessionID: string, command: string): Promise<void> {
  try {
    await openCodeApi.session.shell({ sessionID, command })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function interruptSession(sessionID: string): Promise<void> {
  try {
    await openCodeApi.session.interrupt({ sessionID })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function stageRevert(sessionID: string, messageID: string): Promise<SessionRevert> {
  try {
    return await openCodeApi.session.revert.stage({ sessionID, messageID })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function commitRevert(sessionID: string): Promise<void> {
  try {
    await openCodeApi.session.revert.commit({ sessionID })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function clearRevert(sessionID: string): Promise<void> {
  try {
    await openCodeApi.session.revert.clear({ sessionID })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function compactSession(sessionID: string): Promise<SessionInboxCompaction> {
  try {
    return await openCodeApi.session.compact({ sessionID })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function activateSkill(sessionID: string, id: string): Promise<void> {
  try {
    await openCodeApi.session.skill({ sessionID, id })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function listCommands(directory?: string): Promise<CommandInfo[]> {
  try {
    const { data } = await openCodeApi.command.list(
      directory ? { location: { directory } } : undefined,
    )
    return data
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function listPendingPermissions(directory: string): Promise<PermissionRequest[]> {
  try {
    const { data } = await openCodeApi.permission.request.list({ location: { directory } })
    return data
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function replyPermission(
  sessionID: string,
  requestID: string,
  decision: 'once' | 'always' | 'reject',
  message?: string,
): Promise<void> {
  try {
    await openCodeApi.permission.reply({
      sessionID,
      requestID,
      decision,
      ...(message ? { message } : {}),
    })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function listPendingForms(directory: string): Promise<FormInfo[]> {
  try {
    const { data } = await openCodeApi.form.list({ location: { directory } })
    return data
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function replyForm(sessionID: string, formID: string, answer: FormAnswer): Promise<void> {
  try {
    await openCodeApi.session.form.reply({ sessionID, formID, answer })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function cancelForm(sessionID: string, formID: string): Promise<void> {
  try {
    await openCodeApi.session.form.cancel({ sessionID, formID })
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function findFiles(input: FindFilesInput): Promise<string[]> {
  try {
    const { data } = await openCodeApi.file.find({
      ...(input.directory ? { location: { directory: input.directory } } : {}),
      query: input.query,
      type: 'file',
      limit: input.limit,
    })
    return data.map((entry) => entry.path)
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function listSessionMessages(
  sessionID: string,
  input: SessionMessagesInput = {},
): Promise<SessionMessagesPage> {
  try {
    const { data, cursor } = await openCodeApi.message.list({
      sessionID,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.cursor === undefined ? { order: 'desc' as const } : { cursor: input.cursor }),
    })
    return { messages: [...data].reverse(), nextCursor: cursor.next ?? undefined }
  } catch (error) {
    throw toFetchError(error)
  }
}

export async function readSessionSnapshot(sessionID: string): Promise<SessionSnapshot> {
  try {
    const [page, pending, active] = await Promise.all([
      listSessionMessages(sessionID),
      openCodeApi.session.inbox.list({ sessionID }),
      openCodeApi.session.active(),
    ])
    return {
      messages: page.messages,
      nextCursor: page.nextCursor,
      pending,
      status: active[sessionID] ? 'busy' : 'idle',
    }
  } catch (error) {
    throw toFetchError(error)
  }
}
