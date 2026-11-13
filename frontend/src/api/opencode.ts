import { openCodeLocation, parseOpenCodeModelRef, readSessionGoal } from '@opencode-manager/shared/opencode'
import { MANAGER_PROMPT_CLIENT_METADATA_KEY } from '@opencode-manager/shared/schemas'
import { isMobileViewport } from '@/hooks/useMobile'
import { getDirectoryName } from '@/lib/utils'
import { callOpenCode } from './opencodeApi'
import type {
  AgentInfo,
  CommandInfo,
  FormAnswer,
  FormInfo,
  ModelRef,
  OpenCodeApi,
  PermissionReply,
  PermissionRequest,
  SessionGoalRead,
  SessionInboxCompaction,
  SessionInboxUser,
  SessionInfo,
  SessionMessageInfo,
  SessionRevert,
  SkillInfo,
} from '@opencode-manager/shared/opencode'
import type { SessionSnapshot } from '@/lib/session-projection'

type SessionPromptInput = Parameters<OpenCodeApi['session']['prompt']>[0]

export type PromptFileInput = NonNullable<SessionPromptInput['files']>[number]

export type PromptAgentInput = NonNullable<SessionPromptInput['agents']>[number]

export type PromptSkillInput = NonNullable<SessionPromptInput['skills']>[number]

export type ActiveSessions = Awaited<ReturnType<OpenCodeApi['session']['active']>>

export type ShellInfo = Awaited<ReturnType<OpenCodeApi['shell']['list']>>['data'][number]

export type ShellOutputChunk = Awaited<ReturnType<OpenCodeApi['shell']['output']>>['data']

export type OpenCodeLocationInfo = Awaited<ReturnType<OpenCodeApi['location']['get']>>

export type OpenCodeProject = Awaited<ReturnType<OpenCodeApi['project']['list']>>[number]

export interface RemoteProjectActivity {
  project: OpenCodeProject
  activityAt: number
}

export function sortProjectsByUpdatedAt(projects: OpenCodeProject[]): OpenCodeProject[] {
  return [...projects].sort((a, b) => b.time.updated - a.time.updated)
}

export function rankProjectsBySessionActivity(
  projects: OpenCodeProject[],
  sessions: SessionInfo[],
): RemoteProjectActivity[] {
  const sessionActivityByProjectId = new Map<string, number>()
  for (const session of sessions) {
    const project = findRemoteProjectForDirectory(projects, session.location.directory)
    if (!project) continue
    const updated = session.time.updated
    const current = sessionActivityByProjectId.get(project.id)
    if (current === undefined || updated > current) {
      sessionActivityByProjectId.set(project.id, updated)
    }
  }

  const sessionActivity = (project: OpenCodeProject) => sessionActivityByProjectId.get(project.id)

  return projects
    .map((project) => ({
      project,
      activityAt: sessionActivity(project) ?? project.time.updated,
    }))
    .sort((a, b) => {
      const aHasSession = sessionActivity(a.project) !== undefined
      const bHasSession = sessionActivity(b.project) !== undefined
      if (aHasSession !== bHasSession) return aHasSession ? -1 : 1
      return b.activityAt - a.activityAt
    })
}

export function remoteProjectName(project: OpenCodeProject): string {
  return project.name?.trim() || getDirectoryName(project.canonical)
}

export function findRemoteProjectForDirectory(
  projects: OpenCodeProject[],
  directory: string,
): OpenCodeProject | undefined {
  let owner: OpenCodeProject | undefined
  for (const project of projects) {
    if (directory !== project.canonical && !directory.startsWith(`${project.canonical}/`)) continue
    if (!owner || project.canonical.length > owner.canonical.length) {
      owner = project
    }
  }
  return owner
}

export type VcsInfo = Awaited<ReturnType<OpenCodeApi['vcs']['get']>>['data']

export type VcsFileStatus = Awaited<ReturnType<OpenCodeApi['vcs']['status']>>['data'][number]

export type VcsFileDiff = Awaited<ReturnType<OpenCodeApi['vcs']['diff']>>['data'][number]

export type VcsDiffMode = 'working' | 'branch' | 'committed'

export interface SessionPage {
  items: SessionInfo[]
  nextCursor?: string
}

export type SessionPageInput = NonNullable<Parameters<OpenCodeApi['session']['list']>[0]>

export interface CreateSessionInput {
  directory: string
  title?: string
  agent?: string
  model?: string
}

export type FindFilesInput = Parameters<OpenCodeApi['file']['find']>[0]

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
    files: input.files,
    agents: input.agents,
    skills: input.skills,
    delivery: input.delivery,
  }
}

export async function listSessionPage(input: SessionPageInput, serverId?: string): Promise<SessionPage> {
  const { data, cursor } = await callOpenCode((api) => api.session.list(input), serverId)
  return { items: data, nextCursor: cursor.next ?? undefined }
}

export async function getOpenCodeLocation(directory: string, serverId?: string): Promise<OpenCodeLocationInfo> {
  return callOpenCode((api) => api.location.get(openCodeLocation(directory)), serverId)
}

export async function listProjects(serverId?: string): Promise<OpenCodeProject[]> {
  return callOpenCode((api) => api.project.list(), serverId)
}

export async function getSession(sessionID: string, serverId?: string): Promise<SessionInfo> {
  return callOpenCode((api) => api.session.get({ sessionID }), serverId)
}

export async function getSessionGoal(
  sessionID: string,
  directory: string | undefined,
  serverId?: string,
): Promise<SessionGoalRead> {
  return callOpenCode((api) => readSessionGoal(api, { sessionID, directory }), serverId)
}

export async function createSession(input: CreateSessionInput, serverId?: string): Promise<SessionInfo> {
  const model = input.model ? parseOpenCodeModelRef(input.model) : undefined
  return callOpenCode(
    (api) =>
      api.session.create({
        title: input.title,
        agent: input.agent,
        model,
        location: { directory: input.directory },
      }),
    serverId,
  )
}

export async function deleteSession(sessionID: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.remove({ sessionID }), serverId)
}

export async function renameSession(sessionID: string, title: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.update({ sessionID, title }), serverId)
}

export async function forkSession(sessionID: string, before?: string, serverId?: string): Promise<SessionInfo> {
  return callOpenCode(
    (api) =>
      api.session.fork({
        sessionID,
        before,
      }),
    serverId,
  )
}

export async function addSessionContext(sessionID: string, text: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.synthetic({ sessionID, text, resume: false }), serverId)
}

async function createSessionThen(
  input: CreateSessionInput,
  step: (session: SessionInfo) => Promise<void>,
  serverId?: string,
): Promise<SessionInfo> {
  const session = await createSession(input, serverId)
  try {
    await step(session)
  } catch (error) {
    await deleteSession(session.id, serverId).catch(() => undefined)
    throw error
  }
  return session
}

export async function createSessionWithContext(
  input: CreateSessionInput,
  context: string,
  serverId?: string,
): Promise<SessionInfo> {
  return createSessionThen(input, (session) => addSessionContext(session.id, context, serverId), serverId)
}

export async function createSessionWithPrompt(
  input: CreateSessionInput,
  text: string,
  serverId?: string,
): Promise<SessionInfo> {
  return createSessionThen(
    input,
    async (session) => {
      await sendPrompt({ sessionID: session.id, text }, serverId)
    },
    serverId,
  )
}

export async function switchSessionModel(sessionID: string, model: ModelRef, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.switchModel({ sessionID, model }), serverId)
}

export async function switchSessionAgent(sessionID: string, agent: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.switchAgent({ sessionID, agent }), serverId)
}

export async function sendPrompt(input: SendPromptInput, serverId?: string): Promise<SessionInboxUser> {
  return callOpenCode(
    (api) =>
      api.session.prompt({
        sessionID: input.sessionID,
        ...buildPromptFields(input),
        metadata: { [MANAGER_PROMPT_CLIENT_METADATA_KEY]: isMobileViewport() ? 'mobile' : 'desktop' },
      }),
    serverId,
  )
}

export async function runCommand(input: RunCommandInput, serverId?: string): Promise<void> {
  await callOpenCode(
    (api) =>
      api.session.command({
        sessionID: input.sessionID,
        name: input.name,
        ...buildPromptFields(input),
      }),
    serverId,
  )
}

export async function runShell(sessionID: string, command: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.shell({ sessionID, command }), serverId)
}

export const SIDE_QUESTION_INSTRUCTIONS =
  'The user is asking a quick side question about the conversation so far. Answer directly and concisely in markdown from what you already know. Do not call any tools and do not take any actions.'

export async function askSideQuestion(
  sessionID: string,
  question: string,
  signal?: AbortSignal,
  serverId?: string,
): Promise<string> {
  const result = await callOpenCode(
    (api) =>
      api.session.generate(
        { sessionID, prompt: [SIDE_QUESTION_INSTRUCTIONS, question].join('\n\n') },
        signal ? { signal } : undefined,
      ),
    serverId,
  )
  return result.text.trim()
}

export async function interruptSession(sessionID: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.interrupt({ sessionID }), serverId)
}

export async function backgroundSession(sessionID: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.background({ sessionID }), serverId)
}

export async function putSessionInstruction(
  sessionID: string,
  key: string,
  text: string,
  serverId?: string,
): Promise<void> {
  await callOpenCode(
    (api) => api.session.instructions.entry.put({ sessionID, key, value: text }),
    serverId,
  )
}

export async function removeSessionInstruction(
  sessionID: string,
  key: string,
  serverId?: string,
): Promise<void> {
  await callOpenCode(
    (api) => api.session.instructions.entry.remove({ sessionID, key }),
    serverId,
  )
}

export async function listSessionInstructionKeys(
  sessionID: string,
  serverId?: string,
): Promise<string[]> {
  const entries = await callOpenCode(
    (api) => api.session.instructions.entry.list({ sessionID }),
    serverId,
  )
  return entries.map((entry) => entry.key)
}

export async function listShells(directory: string, serverId?: string): Promise<ShellInfo[]> {
  const { data } = await callOpenCode((api) => api.shell.list(openCodeLocation(directory)), serverId)
  return data
}

export async function readShellOutput(
  id: string,
  directory: string,
  cursor: number,
  limit: number,
  serverId?: string,
): Promise<ShellOutputChunk> {
  const { data } = await callOpenCode(
    (api) => api.shell.output({ id, cursor, limit, ...openCodeLocation(directory) }),
    serverId,
  )
  return data
}

export async function removeShell(id: string, directory: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.shell.remove({ id, ...openCodeLocation(directory) }), serverId)
}

export async function stageRevert(
  sessionID: string,
  messageID: string,
  serverId?: string,
): Promise<SessionRevert> {
  await interruptSession(sessionID, serverId)
  await callOpenCode((api) => api.session.wait({ sessionID }), serverId)
  return callOpenCode((api) => api.session.revert.stage({ sessionID, messageID }), serverId)
}

export async function commitRevert(sessionID: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.revert.commit({ sessionID }), serverId)
}

export async function clearRevert(sessionID: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.revert.clear({ sessionID }), serverId)
}

export async function compactSession(sessionID: string, serverId?: string): Promise<SessionInboxCompaction> {
  return callOpenCode((api) => api.session.compact({ sessionID }), serverId)
}

export async function activateSkill(sessionID: string, id: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.skill({ sessionID, id }), serverId)
}

export async function listActiveSessions(serverId?: string): Promise<ActiveSessions> {
  return callOpenCode((api) => api.session.active(), serverId)
}

export async function listAgents(directory?: string, serverId?: string): Promise<AgentInfo[]> {
  const { data } = await callOpenCode((api) => api.agent.list(openCodeLocation(directory)), serverId)
  return data
}

export async function listCommands(directory?: string, serverId?: string): Promise<CommandInfo[]> {
  const { data } = await callOpenCode((api) => api.command.list(openCodeLocation(directory)), serverId)
  return data
}

export async function listSkills(directory?: string, serverId?: string): Promise<SkillInfo[]> {
  const { data } = await callOpenCode((api) => api.skill.list(openCodeLocation(directory)), serverId)
  return data
}

export async function getVcsInfo(directory: string, serverId?: string): Promise<VcsInfo> {
  const { data } = await callOpenCode((api) => api.vcs.get(openCodeLocation(directory)), serverId)
  return data
}

export async function listVcsStatus(directory: string, serverId?: string): Promise<VcsFileStatus[]> {
  const { data } = await callOpenCode((api) => api.vcs.status(openCodeLocation(directory)), serverId)
  return data
}

export async function getVcsDiff(
  directory: string,
  mode: VcsDiffMode,
  serverId?: string,
): Promise<VcsFileDiff[]> {
  const { data } = await callOpenCode(
    (api) => api.vcs.diff({ ...openCodeLocation(directory), mode }),
    serverId,
  )
  return data
}

export async function listPendingPermissions(
  directory: string,
  serverId?: string,
): Promise<PermissionRequest[]> {
  const { data } = await callOpenCode(
    (api) => api.permission.request.list(openCodeLocation(directory)),
    serverId,
  )
  return data
}

export async function replyPermission(
  sessionID: string,
  requestID: string,
  decision: PermissionReply,
  message?: string,
  serverId?: string,
): Promise<void> {
  await callOpenCode(
    (api) =>
      api.permission.reply({
        sessionID,
        requestID,
        decision,
        message,
      }),
    serverId,
  )
}

export async function listPendingForms(directory: string, serverId?: string): Promise<FormInfo[]> {
  const { data } = await callOpenCode((api) => api.form.list(openCodeLocation(directory)), serverId)
  return data
}

export async function replyForm(
  sessionID: string,
  formID: string,
  answer: FormAnswer,
  serverId?: string,
): Promise<void> {
  await callOpenCode((api) => api.session.form.reply({ sessionID, formID, answer }), serverId)
}

export async function cancelForm(sessionID: string, formID: string, serverId?: string): Promise<void> {
  await callOpenCode((api) => api.session.form.cancel({ sessionID, formID }), serverId)
}

export async function findFiles(input: FindFilesInput, serverId?: string): Promise<string[]> {
  const { data } = await callOpenCode((api) => api.file.find({ ...input, type: 'file' }), serverId)
  return data.map((entry) => entry.path)
}

export async function listSessionMessages(
  sessionID: string,
  input: SessionMessagesInput = {},
  serverId?: string,
): Promise<SessionMessagesPage> {
  const { data, cursor } = await callOpenCode(
    (api) =>
      api.message.list({
        sessionID,
        limit: input.limit,
        cursor: input.cursor,
        order: input.cursor === undefined ? 'desc' : undefined,
      }),
    serverId,
  )
  return { messages: [...data].reverse(), nextCursor: cursor.next ?? undefined }
}

export async function readSessionSnapshot(sessionID: string, serverId?: string): Promise<SessionSnapshot> {
  const [page, pending, active] = await Promise.all([
    listSessionMessages(sessionID, {}, serverId),
    callOpenCode((api) => api.session.inbox.list({ sessionID }), serverId),
    listActiveSessions(serverId),
  ])
  return {
    messages: page.messages,
    nextCursor: page.nextCursor,
    pending,
    status: active[sessionID] ? 'busy' : 'idle',
  }
}
