interface PromptResponsePart {
  type: string
  text?: string
}

interface SessionMessage {
  info: { role: string }
  parts: PromptResponsePart[]
}

export function buildCustomCompactionPrompt(): string {
  return `You are generating a continuation context for a coding session with persistent
project memory. Your summary will be the ONLY context after compaction.
Preserve everything needed for seamless continuation.

## CRITICAL - Preserve These Verbatim
1. The current task/objective (quote the user's original request exactly)
2. ALL file paths being actively worked on (with what's being done)
3. Key decisions made and their rationale
4. Any corrections or gotchas discovered during the session
5. Todo list state (what's done, in progress, pending)

## Structure Your Summary As:

### Active Task
[Verbatim objective + what was happening when compaction fired]

### Key Context
[Decisions, constraints, user preferences, corrections]

### Active Files
[filepath -> what's being done to it]

### Next Steps
[What should happen immediately after compaction]

## Rules
- Use specific file paths.
- State what tools returned, not just that they were called
- Prefer completeness over brevity - this is the agent's entire working memory`
}

export function formatCompactionDiagnostics(stats: {
  conventions: number
  decisions: number
  tokensInjected: number
}): string {
  const parts: string[] = []

  if (stats.conventions > 0) {
    parts.push(`${stats.conventions} convention${stats.conventions !== 1 ? 's' : ''}`)
  }

  if (stats.decisions > 0) {
    parts.push(`${stats.decisions} decision${stats.decisions !== 1 ? 's' : ''}`)
  }

  if (parts.length === 0) return ''

  return `> **Compaction preserved:** ${parts.join(', ')} (~${stats.tokensInjected} tokens injected)`
}

export function extractCompactionSummary(messages: SessionMessage[]): string | null {
  const reversed = [...messages].reverse()
  for (const msg of reversed) {
    if (msg.info.role !== 'assistant') continue
    const textParts = msg.parts
      .filter((p): p is PromptResponsePart & { text: string } => p.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
    if (textParts.length > 0) return textParts.join('\n')
  }
  return null
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function trimToTokenBudget(
  content: string,
  maxTokens: number,
  priority: 'high' | 'medium' | 'low'
): string {
  const maxChars = maxTokens * 4
  if (content.length <= maxChars) return content

  if (priority === 'low') {
    return content.slice(0, maxChars) + '...'
  }

  const lines = content.split('\n')
  const trimmed: string[] = []

  let currentChars = 0
  const skipFromEnd = priority === 'medium' ? Math.floor(lines.length * 0.2) : 0

  const linesToUse = skipFromEnd > 0 ? lines.slice(0, -skipFromEnd) : lines

  for (const line of linesToUse) {
    if (currentChars + line.length + 1 > maxChars) break
    trimmed.push(line)
    currentChars += line.length + 1
  }

  if (trimmed.length < linesToUse.length) {
    trimmed.push('...')
  }

  return trimmed.join('\n')
}
