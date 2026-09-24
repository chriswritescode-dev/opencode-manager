import type {
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
} from '@opencode-manager/shared/opencode'
import type { Session } from '@/api/types'
import { saveFile } from './download'

type AssistantContent = SessionMessageAssistant['content'][number]
type AssistantTool = Extract<AssistantContent, { type: 'tool' }>

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_\s]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 50)
}

function formatToolPart(part: AssistantTool): string {
  const state = part.state
  let content = `### Tool: ${part.name}\n`
  content += `*Status: ${state.status}*\n\n`

  if (state.status === 'streaming') {
    return content
  }

  if (state.input) {
    content += '**Input:**\n```json\n'
    content += JSON.stringify(state.input, null, 2)
    content += '\n```\n\n'
  }

  if (state.status === 'completed') {
    const output = state.content
      .filter((entry) => entry.type === 'text')
      .map((entry) => entry.text)
      .join('\n')
    if (output) {
      content += '**Output:**\n```\n'
      content += output
      content += '\n```\n'
    }
  }

  if (state.status === 'error') {
    content += '**Error:**\n```\n'
    content += state.error.message
    content += '\n```\n'
  }

  return content
}

function formatAssistantContent(part: AssistantContent): string {
  switch (part.type) {
    case 'text':
      return part.text
    case 'reasoning':
      return `<details>\n<summary>Reasoning</summary>\n\n${part.text}\n\n</details>\n`
    case 'tool':
      return formatToolPart(part)
    default:
      return ''
  }
}

function formatUserMessage(message: SessionMessageUser): string {
  let content = message.text
  for (const file of message.files ?? []) {
    content += `\n\n*Attached file: ${file.name || 'unknown'}*`
  }
  for (const agent of message.agents ?? []) {
    content += `\n\n**Agent: ${agent.name}**`
  }
  for (const skill of message.skills ?? []) {
    content += `\n\n**Skill: ${skill.name}**`
  }
  return content
}

function formatShellMessage(message: SessionMessageShell): string {
  const status = message.exit === undefined
    ? message.status
    : `${message.status} (exit ${message.exit})`
  let content = `\`$ ${message.command}\`\n\n*Status: ${status}*\n`
  if (message.output?.output) {
    content += `\n**Output:**\n\`\`\`\n${message.output.output}\n\`\`\`\n`
  }
  return content
}

function formatMessage(message: SessionMessageInfo): string {
  switch (message.type) {
    case 'user':
      return formatUserMessage(message)
    case 'assistant':
      return message.content.map(formatAssistantContent).filter(Boolean).join('\n')
    case 'shell':
      return formatShellMessage(message)
    case 'synthetic':
    case 'system':
    case 'skill':
      return `*${message.text}*`
    default:
      return ''
  }
}

function generateSessionMarkdown(
  messages: SessionMessageInfo[],
  session: Session
): string {
  const lines: string[] = []
  
  lines.push(`# ${session.title || 'Untitled Session'}`)
  lines.push('')
  lines.push(`**Session ID:** ${session.id}`)
  lines.push(`**Created:** ${formatDate(session.time.created)}`)
  lines.push('')
  lines.push('---')
  lines.push('')
  
  for (const message of messages) {
    const role = message.type === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${role}`)
    lines.push('')
    
    const content = formatMessage(message)
    if (content) {
      lines.push(content)
      lines.push('')
    }
    
    lines.push('---')
    lines.push('')
  }
  
  return lines.join('\n')
}

export async function downloadMarkdown(content: string, filename: string): Promise<boolean> {
  return saveFile(new Blob([content], { type: 'text/markdown' }), filename)
}

export function exportSession(
  messages: SessionMessageInfo[],
  session: Session
): { filename: string; content: string } {
  const markdown = generateSessionMarkdown(messages, session)
  const titlePart = session.title ? sanitizeFilename(session.title) : 'session'
  const filename = `${titlePart}-${session.id}.md`
  
  return { filename, content: markdown }
}
