type InjectedMemoryRole = 'code' | 'auditor' | 'architect'

export const INJECTED_MEMORY_HEADER = `## Injected Memory

Your messages may include \`<project-memory>\` blocks containing memories automatically retrieved based on semantic similarity to the current message. Each entry has the format \`#<id> [<scope>] <content>\`.`

const SCOPE_DESCRIPTIONS: Record<InjectedMemoryRole, string> = {
  code: `- **[convention]**: Rules to follow — coding style, naming patterns, workflow preferences
- **[decision]**: Architectural choices with rationale — treat as constraints
- **[context]**: Reference information — file locations, domain knowledge, known issues`,
  auditor: `- **[convention]**: Rules to check code against
- **[decision]**: Architectural constraints that may apply
- **[context]**: Reference information and persisted review findings`,
  architect: `- **[convention]**: Rules to follow when planning
- **[decision]**: Architectural constraints with rationale
- **[context]**: Reference information — file locations, domain knowledge`,
}

const SCOPE_GUIDANCE: Record<InjectedMemoryRole, string> = {
  code: `These memories may be stale or irrelevant to the current task. Use your judgement. If a memory seems outdated or incorrect for the current task, you can ignore it.
If you notice patterns of outdated or incorrect memories, consider asking the user to curate them. Use the @Librarian subagent to perform memory research and contradiction resolution.`,
  auditor: `These memories may be stale or irrelevant. Use your judgement — if a memory seems outdated, flag it in your review observations and recommend the calling agent update or delete it.`,
  architect: `These memories may be stale or irrelevant. Use your judgement — if a memory seems outdated, note it in your plan and recommend updating or deleting it via memory-edit or memory-delete. Use the @Librarian subagent to perform memory research and contradiction resolution when needed.`,
}

export function getInjectedMemory(role: InjectedMemoryRole): string {
  return `${INJECTED_MEMORY_HEADER}

${SCOPE_DESCRIPTIONS[role]}

${SCOPE_GUIDANCE[role]}`
}
