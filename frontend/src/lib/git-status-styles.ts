export const GIT_STATUS_COLORS = {
  modified: 'text-amber-600 dark:text-amber-400',
  added: 'text-emerald-600 dark:text-emerald-400',
  deleted: 'text-rose-600 dark:text-rose-400',
  renamed: 'text-blue-600 dark:text-blue-400',
  untracked: 'text-gray-500 dark:text-gray-400',
  copied: 'text-emerald-600 dark:text-emerald-400',
} as const

export const GIT_UI_COLORS = {
  ahead: 'text-emerald-600 dark:text-emerald-400',
  behind: 'text-amber-600 dark:text-amber-400',
  current: 'text-emerald-600 dark:text-emerald-400',
  remote: 'text-blue-600 dark:text-blue-400',
  stage: 'text-emerald-600 dark:text-emerald-400',
  unstage: 'text-rose-600 dark:text-rose-400',
  stagedBadge: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400',
  unpushed: 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400',
  pushed: 'bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400',
} as const

export const GIT_STATUS_LABELS = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'Untracked',
  copied: 'Copied',
} as const
