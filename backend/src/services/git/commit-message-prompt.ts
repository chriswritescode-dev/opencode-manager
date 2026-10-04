export const MAX_COMMIT_PROMPT_DIFF_CHARS = 60_000

export interface CommitMessageContext {
  stagedStat: string
  stagedDiff: string
  recentSubjects: string[]
}

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_COMMIT_PROMPT_DIFF_CHARS) {
    return diff
  }
  return `${diff.slice(0, MAX_COMMIT_PROMPT_DIFF_CHARS)}\n[diff truncated]`
}

export function buildCommitMessagePrompt({ stagedStat, stagedDiff, recentSubjects }: CommitMessageContext): string {
  const subjects = recentSubjects.length > 0
    ? recentSubjects.map(subject => `- ${subject}`).join('\n')
    : '(no recent commits)'

  return [
    'Write a single commit message for the staged changes below.',
    'Match the style of the recent commit subjects when they establish a convention, such as a conventional-commit prefix.',
    'Use a subject line of 72 characters or fewer, followed by an optional short body separated by a blank line.',
    'Return only the commit message text. Do not wrap it in code fences and do not prefix it with a label.',
    '',
    'Recent commit subjects:',
    subjects,
    '',
    'Staged changes (stat):',
    stagedStat.trim(),
    '',
    'Staged diff:',
    truncateDiff(stagedDiff),
  ].join('\n')
}

const COMMIT_MESSAGE_LABEL = /^(?:commit message|message)\s*:\s*/i

export function normalizeGeneratedCommitMessage(text: string): string {
  let normalized = text.trim().replace(COMMIT_MESSAGE_LABEL, '')

  const fenced = normalized.match(/^```[^\n]*\n?([\s\S]*?)\n?```$/)
  if (fenced) {
    normalized = (fenced[1] ?? '').trim()
  }

  return normalized.replace(COMMIT_MESSAGE_LABEL, '').trim()
}
