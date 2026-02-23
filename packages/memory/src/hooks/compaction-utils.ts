import type { PlanningState } from '../types'

export function buildCustomCompactionPrompt(): string {
  return `You are generating a continuation context for a coding session with persistent
project memory. Your summary will be the ONLY context after compaction.
Preserve everything needed for seamless continuation.

## CRITICAL - Preserve These Verbatim
1. The current task/objective (quote the user's original request exactly)
2. Active planning state: current phase, completed phases, next steps, blockers
3. ALL file paths being actively worked on (with what's being done)
4. Key decisions made and their rationale
5. Any corrections or gotchas discovered during the session
6. Todo list state (what's done, in progress, pending)

## Structure Your Summary As:

### Active Task
[Verbatim objective + what was happening when compaction fired]

### Planning State
[Phases with status and notes]

### Key Context
[Decisions, constraints, user preferences, corrections]

### Active Files
[filepath -> what's being done to it]

### Next Steps
[What should happen immediately after compaction]

## Rules
- Use specific file paths, phase names - NOT vague references
- State what tools returned, not just that they were called
- Prefer completeness over brevity - this is the agent's entire working memory`
}

export function formatPlanningState(planningState: PlanningState | null): string | null {
  if (!planningState) return null

  const sections: string[] = []

  if (planningState.objective) {
    sections.push(`**Objective:** ${planningState.objective}`)
  }

  if (planningState.current) {
    sections.push(`**Current:** ${planningState.current}`)
  }

  if (planningState.next) {
    sections.push(`**Next:** ${planningState.next}`)
  }

  if (planningState.phases && planningState.phases.length > 0) {
    sections.push('\n### Phases:')
    for (const phase of planningState.phases) {
      const statusIcon = phase.status === 'completed' ? '[x]' : phase.status === 'in_progress' ? '[~]' : '[ ]'
      const notes = phase.notes ? ` - ${phase.notes}` : ''
      sections.push(`- ${statusIcon} ${phase.title}${notes}`)
    }
  }

  if (planningState.findings && planningState.findings.length > 0) {
    sections.push('\n### Key Findings:')
    for (const finding of planningState.findings) {
      sections.push(`- ${finding}`)
    }
  }

  if (planningState.errors && planningState.errors.length > 0) {
    sections.push('\n### Errors to Avoid:')
    for (const error of planningState.errors) {
      sections.push(`- ${error}`)
    }
  }

  return sections.join('\n')
}

export function formatCompactionDiagnostics(stats: {
  planningPhases: number
  conventions: number
  decisions: number
  tokensInjected: number
}): string {
  const parts: string[] = []

  if (stats.planningPhases > 0) {
    parts.push(`${stats.planningPhases} planning phase${stats.planningPhases !== 1 ? 's' : ''}`)
  }

  if (stats.conventions > 0) {
    parts.push(`${stats.conventions} convention${stats.conventions !== 1 ? 's' : ''}`)
  }

  if (stats.decisions > 0) {
    parts.push(`${stats.decisions} decision${stats.decisions !== 1 ? 's' : ''}`)
  }

  if (parts.length === 0) return ''

  return `> **Compaction preserved:** ${parts.join(', ')} (~${stats.tokensInjected} tokens injected)`
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
