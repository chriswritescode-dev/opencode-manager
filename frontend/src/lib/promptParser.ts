import type { ContentPart, FileInfo } from '@/api/types'

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

export function parsePromptToParts(
  rawInput: string,
  fileMap: Map<string, FileInfo>
): ContentPart[] {
  const parts: ContentPart[] = []
  let lastIndex = 0
  
  for (const match of rawInput.matchAll(MENTION_PATTERN)) {
    const matchIndex = match.index!
    
    if (matchIndex > lastIndex) {
      const textContent = rawInput.slice(lastIndex, matchIndex)
      if (textContent.trim()) {
        parts.push({ type: 'text', content: textContent })
      }
    }
    
    const mentionText = match[1]
    const file = fileMap.get(mentionText.toLowerCase())
    
    if (file) {
      parts.push({
        type: 'file',
        path: file.path,
        name: file.name
      })
    } else {
      parts.push({ type: 'text', content: match[0] })
    }
    
    lastIndex = matchIndex + match[0].length
  }
  
  if (lastIndex < rawInput.length) {
    const textContent = rawInput.slice(lastIndex)
    if (textContent.trim()) {
      parts.push({ type: 'text', content: textContent })
    }
  }
  
  return parts.length > 0 ? parts : [{ type: 'text', content: '' }]
}

export function getFilename(path: string): string {
  return path.split('/').pop() || path
}

export function getDirectory(path: string): string {
  const parts = path.split('/')
  return parts.slice(0, -1).join('/') || '.'
}
