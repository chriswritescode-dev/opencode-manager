import type { PromptAgentInput, PromptFileInput, PromptSkillInput } from '@/api/opencode'
import type { FileAttachmentInfo, ImageAttachment } from '@/api/types'

export const MENTION_PATTERN = /@([A-Za-z0-9_\-./]+)/g
export const MENTION_TRIGGER_PATTERN = /(^|\s)@([A-Za-z0-9_\-./]*)$/

export interface MentionTrigger {
  start: number
  end: number
  query: string
}

export interface AgentInfo {
  name: string
  description?: string
}

export function detectMentionTrigger(
  text: string,
  cursorPosition: number
): MentionTrigger | null {
  const textBeforeCursor = text.slice(0, cursorPosition)
  const match = textBeforeCursor.match(MENTION_TRIGGER_PATTERN)
  
  if (!match || match.index === undefined) return null
  
  const atIndex = match.index + match[1].length
  return {
    start: atIndex,
    end: cursorPosition,
    query: match[2]
  }
}

export function filterAgentsByQuery(agents: AgentInfo[], query: string): AgentInfo[] {
  const lowerQuery = query.toLowerCase()
  return agents.filter(agent => 
    agent.name.toLowerCase().includes(lowerQuery)
  )
}

export interface ParsedPromptInput {
  text: string
  files: PromptFileInput[]
  agents: PromptAgentInput[]
  skills: PromptSkillInput[]
}

export function parsePromptToInput(
  rawInput: string,
  fileMap: Map<string, FileAttachmentInfo>,
  agentNames: string[],
  imageAttachments?: ImageAttachment[]
): ParsedPromptInput {
  const files: PromptFileInput[] = []
  const agents: PromptAgentInput[] = []
  const agentNameByLowercase = new Map(agentNames.map((name) => [name.toLowerCase(), name]))

  for (const match of rawInput.matchAll(MENTION_PATTERN)) {
    const matchIndex = match.index!
    const mentionText = match[1]
    const mention = { start: matchIndex, end: matchIndex + match[0].length, text: match[0] }

    const file = fileMap.get(mentionText.toLowerCase())
    if (file) {
      files.push({ uri: `file://${file.path}`, name: file.name, mention })
      continue
    }

    const agentName = agentNameByLowercase.get(mentionText.toLowerCase())
    if (agentName) {
      agents.push({ name: agentName, mention })
    }
  }

  for (const attachment of imageAttachments ?? []) {
    files.push({ uri: attachment.dataUrl, name: attachment.filename })
  }

  return { text: rawInput, files, agents, skills: [] }
}

export function getFilename(path: string): string {
  return path.split('/').pop() || path
}

export function getDirectory(path: string): string {
  const parts = path.split('/')
  return parts.slice(0, -1).join('/') || '.'
}
