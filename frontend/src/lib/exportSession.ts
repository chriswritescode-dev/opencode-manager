import type { MessageWithParts, Session, Part } from '@/api/types'

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

function formatPartContent(part: Part): string {
  switch (part.type) {
    case 'text':
      return part.text || ''
    case 'tool':
      return formatToolPart(part)
    case 'reasoning':
      return `<details>\n<summary>Reasoning</summary>\n\n${part.text || ''}\n\n</details>\n`
    case 'patch':
      return formatPatchPart(part)
    case 'file':
      return `*Attached file: ${part.filename || 'unknown'}*`
    case 'step-finish':
      return `*Cost: $${part.cost?.toFixed(4) || '0'} | Tokens: ${(part.tokens?.input || 0) + (part.tokens?.output || 0)}*`
    case 'snapshot':
      return `*Snapshot: ${part.snapshot || 'unknown'}*`
    case 'agent':
      return `**Agent: ${part.name || 'unknown'}**`
    default:
      return ''
  }
}

function formatToolPart(part: Part): string {
  if (part.type !== 'tool') return ''
  
  const toolName = part.tool || 'Unknown Tool'
  const state = part.state
  const status = state?.status || 'unknown'
  
  let content = `### Tool: ${toolName}\n`
  content += `*Status: ${status}*\n\n`
  
  if (state && 'input' in state && state.input) {
    content += '**Input:**\n```json\n'
    content += JSON.stringify(state.input, null, 2)
    content += '\n```\n\n'
  }
  
  if (state && 'output' in state && state.output) {
    content += '**Output:**\n```\n'
    content += state.output
    content += '\n```\n'
  }
  
  if (state && 'error' in state && state.error) {
    content += '**Error:**\n```\n'
    content += state.error
    content += '\n```\n'
  }
  
  return content
}

function formatPatchPart(part: Part): string {
  if (part.type !== 'patch') return ''
  
  let content = `### File Changes\n`
  
  if (part.files && part.files.length > 0) {
    content += `*Files: ${part.files.join(', ')}*\n\n`
  }
  
  return content
}

export function generateSessionMarkdown(
  messages: MessageWithParts[],
  session: Session
): string {
  const lines: string[] = []
  
  lines.push(`# ${session.title || 'Untitled Session'}`)
  lines.push('')
  lines.push(`**Session ID:** ${session.id}`)
  lines.push(`**Created:** ${formatDate(session.time.created)}`)
  if (session.share?.url) {
    lines.push(`**Shared:** [View](${session.share.url})`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  
  for (const message of messages) {
    const role = message.info.role === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${role}`)
    lines.push('')
    
    for (const part of message.parts) {
      const content = formatPartContent(part)
      if (content) {
        lines.push(content)
        lines.push('')
      }
    }
    
    lines.push('---')
    lines.push('')
  }
  
  return lines.join('\n')
}

export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function exportSession(
  messages: MessageWithParts[],
  session: Session
): { filename: string; content: string } {
  const markdown = generateSessionMarkdown(messages, session)
  const titlePart = session.title ? sanitizeFilename(session.title) : 'session'
  const filename = `${titlePart}-${session.id}.md`
  
  return { filename, content: markdown }
}
