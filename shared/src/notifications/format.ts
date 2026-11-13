import { z } from 'zod'
import type { GoalState, GoalStatus } from '../opencode/goal'
import type { MultiRunEntryStatus } from '../schemas/multi-runs'
import type { JsonObject, JsonValue } from '../utils/json'
import { JsonObjectSchema } from '../utils/json'

const MULTI_RUN_ENTRY_STATUS_LABELS = {
  starting: 'Starting',
  started: 'Started',
  failed: 'Failed',
  discarded: 'Discarded',
} satisfies Record<MultiRunEntryStatus, string>

export function getMultiRunEntryStatusLabel(status: MultiRunEntryStatus): string {
  return MULTI_RUN_ENTRY_STATUS_LABELS[status]
}

const GOAL_STATUS_TITLES = {
  active: 'Goal active',
  paused: 'Goal paused',
  complete: 'Goal completed',
} satisfies Record<GoalStatus, string>

export function getGoalStatusTitle(status: GoalStatus): string {
  return GOAL_STATUS_TITLES[status]
}

export function getGoalRoundsLabel(goal: Pick<GoalState, 'rounds' | 'maxRounds'>): string {
  return `Round ${goal.rounds}/${goal.maxRounds}`
}

const PERMISSION_LABELS = new Map<string, string>([
  ['read', 'Read File'],
  ['edit', 'Edit File'],
  ['glob', 'Search Files'],
  ['grep', 'Search Content'],
  ['shell', 'Run Command'],
  ['subagent', 'Run Subagent'],
  ['external_directory', 'External Access'],
  ['question', 'Ask Question'],
  ['webfetch', 'Fetch URL'],
  ['websearch', 'Web Search'],
  ['skill', 'Use Skill'],
])

export function getPermissionLabel(permission: string): string {
  if (!permission) return 'Approval'
  return PERMISSION_LABELS.get(permission) ?? permission.charAt(0).toUpperCase() + permission.slice(1)
}

export function getPermissionPhrase(action: string): string {
  return getPermissionLabel(action)
    .split(' ')
    .map((word) => (word === word.toUpperCase() ? word : word.toLowerCase()))
    .join(' ')
}

export interface PermissionLike {
  action?: string
  metadata?: Record<string, JsonValue>
  resources?: string[]
  save?: string[]
}

export interface PermissionDetail {
  primary: string
  secondary?: string
  label?: string
}

interface PermissionResourceLabels {
  one: string
  many: string
}

const PERMISSION_RESOURCE_LABELS = new Map<string, PermissionResourceLabels>([
  ['shell', { one: 'Command', many: 'Commands' }],
  ['glob', { one: 'Pattern', many: 'Patterns' }],
  ['grep', { one: 'Pattern', many: 'Patterns' }],
  ['read', { one: 'Path', many: 'Paths' }],
  ['list', { one: 'Path', many: 'Paths' }],
  ['edit', { one: 'File', many: 'Files' }],
  ['external_directory', { one: 'Path', many: 'Paths' }],
  ['webfetch', { one: 'URL', many: 'URLs' }],
])

const DEFAULT_PERMISSION_RESOURCE_LABELS: PermissionResourceLabels = { one: 'Resource', many: 'Resources' }

function getPermissionResourceLabel(action: string, count: number): string {
  const labels = PERMISSION_RESOURCE_LABELS.get(action) ?? DEFAULT_PERMISSION_RESOURCE_LABELS
  return count > 1 ? labels.many : labels.one
}

const PermissionFileSchema = z.object({
  file: z.string().optional(),
  patch: z.string().optional(),
})

const PermissionFileListSchema = z.array(PermissionFileSchema)

function readNonEmptyString(value: JsonValue | undefined): string | undefined {
  const text = z.string().safeParse(value)
  return text.success && text.data.length > 0 ? text.data : undefined
}

function readJsonObject(value: JsonValue | undefined): JsonObject {
  const object = JsonObjectSchema.safeParse(value)
  return object.success ? object.data : {}
}

export function getPermissionDetail(input: PermissionLike): PermissionDetail {
  const action = input.action ?? ''
  const metadata = readJsonObject(input.metadata)
  const resources = input.resources ?? []

  if (action === 'edit') {
    const files = PermissionFileListSchema.safeParse(metadata['files'])
    const firstFile = readJsonObject(files.success ? files.data[0] : undefined)
    const filePath = readNonEmptyString(firstFile['file']) ?? readNonEmptyString(metadata['filepath'])
    if (filePath) {
      const diff = readNonEmptyString(firstFile['patch']) ?? readNonEmptyString(metadata['diff'])
      return {
        primary: filePath,
        secondary: diff ? diff.slice(0, 500) + (diff.length > 500 ? '\n...' : '') : undefined,
        label: getPermissionResourceLabel('edit', 1),
      }
    }
  }

  if (action === 'webfetch') {
    const url = readNonEmptyString(metadata['url'])
    if (url) return { primary: url, label: getPermissionResourceLabel('webfetch', 1) }
  }

  return { primary: resources.join('\n'), label: getPermissionResourceLabel(action, resources.length) }
}

export interface PermissionAlwaysScope {
  summary: string
  patterns: string[]
}

export function getPermissionAlwaysScope(input: PermissionLike): PermissionAlwaysScope | null {
  const action = input.action ?? ''
  const save = z.array(z.string()).safeParse(input.save)
  if (!save.success || save.data.length === 0) return null
  if (save.data.length === 1 && save.data[0] === '*') {
    return { summary: `This will always allow ${getPermissionPhrase(action)} for this project.`, patterns: [] }
  }
  return { summary: 'This will always allow the following patterns for this project.', patterns: save.data }
}

export interface FormLike {
  title?: unknown
}

export function getFormText(form: FormLike | null | undefined): string {
  if (!form) return ''
  const title = z.string().safeParse(form.title)
  return title.success && title.data.length > 0 ? title.data : ''
}
