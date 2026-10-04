import type { GitOperationState } from '@opencode-manager/shared'

interface ConflictResolutionPromptInput {
  operation: GitOperationState
  branch: string
}

export function buildConflictResolutionPrompt({ operation, branch }: ConflictResolutionPromptInput): string {
  const conflictedFiles = operation.conflictedFiles.map((file) => `- ${file}`).join('\n')

  return [
    `A git ${operation.kind} is in progress on branch \`${branch}\` and stopped with merge conflicts.`,
    '',
    'Conflicted files:',
    conflictedFiles,
    '',
    'Work through this in order:',
    '1. Inspect each conflicted file and understand both sides of every conflict.',
    '2. Propose a per-file resolution strategy with your reasoning.',
    '3. Wait for the user to confirm the strategy before editing any file.',
    '',
    `After the user confirms, resolve the conflicts, stage each resolved file with \`git add\`, and finish the operation with \`GIT_EDITOR=true git ${operation.kind} --continue\`.`,
    '',
    `Do not run \`git ${operation.kind} --abort\` and do not force-push unless the user explicitly asks.`,
  ].join('\n')
}
