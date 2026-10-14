import type { SessionGoal, SessionGoalStatus, SessionGoalStopReason } from '../schemas/session-goals'
import type { MultiRunEntryStatus } from '../schemas/multi-runs'

const GOAL_OUTCOME_TITLES: Record<SessionGoalStatus, string> = {
  active: 'Goal active',
  paused: 'Goal paused',
  completed: 'Goal completed',
  blocked: 'Goal blocked',
  stopped: 'Goal stopped',
}

const GOAL_STOP_REASON_LABELS: Record<SessionGoalStopReason, string> = {
  cancelled: 'Cancelled',
  user_paused: 'Paused by user',
  continuation_limit: 'Continuation limit reached',
  token_budget: 'Token budget reached',
  turn_error: 'Turn failed',
  interrupted: 'Interrupted',
  audit_failed: 'Audit failed',
  session_deleted: 'Session deleted',
}

export function getGoalOutcomeTitle(status: SessionGoalStatus): string {
  return GOAL_OUTCOME_TITLES[status]
}

export function getGoalStopReasonLabel(stopReason: SessionGoalStopReason): string {
  return GOAL_STOP_REASON_LABELS[stopReason]
}

export function getGoalOutcomeReason(goal: Pick<SessionGoal, 'stopReason' | 'lastReason'>): string | null {
  return goal.stopReason ? getGoalStopReasonLabel(goal.stopReason) : goal.lastReason
}

const MULTI_RUN_ENTRY_STATUS_LABELS: Record<MultiRunEntryStatus, string> = {
  starting: 'Starting',
  started: 'Started',
  failed: 'Failed',
  discarded: 'Discarded',
}

export function getMultiRunEntryStatusLabel(status: MultiRunEntryStatus): string {
  return MULTI_RUN_ENTRY_STATUS_LABELS[status]
}

export function getGoalTurnLabel(goal: Pick<SessionGoal, 'continuationCount' | 'maxContinuations'>): string {
  return `Turn ${goal.continuationCount}/${goal.maxContinuations}`
}

export function getGoalTokenLabel(goal: Pick<SessionGoal, 'tokensUsed' | 'tokenBudget'>): string | null {
  if (goal.tokenBudget === null) return null
  return `${goal.tokensUsed.toLocaleString()}/${goal.tokenBudget.toLocaleString()} tokens`
}

const PERMISSION_LABELS: Record<string, string> = {
  read: 'Read File',
  edit: 'Edit File',
  glob: 'Search Files',
  grep: 'Search Content',
  shell: 'Run Command',
  subagent: 'Run Subagent',
  external_directory: 'External Access',
  question: 'Ask Question',
  webfetch: 'Fetch URL',
  websearch: 'Web Search',
  skill: 'Use Skill',
}

export function getPermissionLabel(permission: string): string {
  if (!permission) return 'Approval'
  return PERMISSION_LABELS[permission] ?? permission.charAt(0).toUpperCase() + permission.slice(1)
}

interface PermissionLike {
  action?: unknown
  metadata?: unknown
  resources?: unknown
  save?: unknown
}

export interface PermissionDetail {
  primary: string
  secondary?: string
  label?: string
}

const PERMISSION_RESOURCE_LABELS: Record<string, { one: string; many: string }> = {
  shell: { one: 'Command', many: 'Commands' },
  glob: { one: 'Pattern', many: 'Patterns' },
  grep: { one: 'Pattern', many: 'Patterns' },
  read: { one: 'Path', many: 'Paths' },
  list: { one: 'Path', many: 'Paths' },
  edit: { one: 'File', many: 'Files' },
  external_directory: { one: 'Path', many: 'Paths' },
  webfetch: { one: 'URL', many: 'URLs' },
}

function getPermissionResourceLabel(action: string, count: number): string {
  const labels = PERMISSION_RESOURCE_LABELS[action] ?? { one: 'Resource', many: 'Resources' }
  return count > 1 ? labels.many : labels.one
}

export function getPermissionDetail(input: PermissionLike): PermissionDetail {
  const action = typeof input.action === 'string' ? input.action : ''
  const metadata = (input.metadata && typeof input.metadata === 'object' ? input.metadata : {}) as Record<string, unknown>
  const resources = Array.isArray(input.resources) ? input.resources.filter((resource): resource is string => typeof resource === 'string') : []
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

  switch (action) {
    case 'edit': {
      const files = Array.isArray(metadata.files) ? metadata.files : []
      const first = (files[0] && typeof files[0] === 'object' ? files[0] : {}) as Record<string, unknown>
      const filePath = str(first.file) ?? str(metadata.filepath)
      if (filePath) {
        const diff = str(first.patch) ?? str(metadata.diff)
        return {
          primary: filePath,
          secondary: diff ? diff.slice(0, 500) + (diff.length > 500 ? '\n...' : '') : undefined,
          label: getPermissionResourceLabel('edit', 1),
        }
      }
      break
    }
    case 'webfetch': {
      const url = str(metadata.url)
      if (url) return { primary: url, label: getPermissionResourceLabel('webfetch', 1) }
      break
    }
  }

  return { primary: resources.join('\n'), label: getPermissionResourceLabel(action, resources.length) }
}

export interface PermissionAlwaysScope {
  summary: string
  patterns: string[]
}

export function getPermissionAlwaysScope(input: PermissionLike): PermissionAlwaysScope | null {
  const action = typeof input.action === 'string' ? input.action : ''
  const save = Array.isArray(input.save) ? input.save.filter((item): item is string => typeof item === 'string') : []
  if (save.length === 0) return null
  if (save.length === 1 && save[0] === '*') {
    return { summary: `This will always allow ${action} for this project.`, patterns: [] }
  }
  return { summary: 'This will always allow the following patterns for this project.', patterns: save }
}

interface FormLike {
  title?: unknown
}

export function getFormText(form: FormLike | null | undefined): string {
  return form && typeof form.title === 'string' && form.title.length > 0 ? form.title : ''
}
