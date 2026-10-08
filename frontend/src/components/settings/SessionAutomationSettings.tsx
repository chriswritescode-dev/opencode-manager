import { useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useAutosavedSetting } from '@/hooks/useAutosavedSetting'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ModelCombobox } from '@/components/model/ModelCombobox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DEFAULT_SESSION_DEFAULTS,
  GOAL_MAX_CONTINUATIONS_MAX,
  GOAL_MAX_CONTINUATIONS_MIN,
  type SessionDefaults,
  type SessionPermissionMode,
} from '@opencode-manager/shared/schemas'

interface GoalDraft {
  goalAuditorModel: string
  goalMaxContinuations: string
  goalTokenBudget: string
}

interface GoalCommitted {
  goalAuditorModel: string | undefined
  goalMaxContinuations: number
  goalTokenBudget: number | undefined
}

function maxContinuationsFromInput(value: string): number | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < GOAL_MAX_CONTINUATIONS_MIN || parsed > GOAL_MAX_CONTINUATIONS_MAX) return null
  return parsed
}

function tokenBudgetFromInput(value: string): { valid: boolean; value: number | undefined } {
  const trimmed = value.trim()
  if (trimmed === '') return { valid: true, value: undefined }
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? { valid: true, value: parsed } : { valid: false, value: undefined }
}

export function SessionAutomationSettings() {
  const { preferences, updateSettings } = useSettings()
  const sessionDefaults = preferences?.sessionDefaults
  const permissionMode = sessionDefaults?.permissionMode ?? DEFAULT_SESSION_DEFAULTS.permissionMode

  const updateSessionDefaults = useCallback(
    (patch: Partial<SessionDefaults>) => {
      updateSettings({
        sessionDefaults: {
          ...sessionDefaults,
          permissionMode,
          ...patch,
        },
      })
    },
    [sessionDefaults, permissionMode, updateSettings],
  )

  const { draft, setDraft, commit: commitGoalFields } = useAutosavedSetting<SessionDefaults | undefined, GoalDraft, GoalCommitted>({
    stored: sessionDefaults,
    toDraft: (stored) => ({
      goalAuditorModel: stored?.goalAuditorModel ?? '',
      goalMaxContinuations: String(stored?.goalMaxContinuations ?? DEFAULT_SESSION_DEFAULTS.goalMaxContinuations),
      goalTokenBudget: stored?.goalTokenBudget !== undefined ? String(stored.goalTokenBudget) : '',
    }),
    toCommitted: (current, previous) => {
      const budget = tokenBudgetFromInput(current.goalTokenBudget)
      return {
        goalAuditorModel: current.goalAuditorModel.trim() || undefined,
        goalMaxContinuations:
          maxContinuationsFromInput(current.goalMaxContinuations) ??
          previous?.goalMaxContinuations ??
          DEFAULT_SESSION_DEFAULTS.goalMaxContinuations,
        goalTokenBudget: budget.valid ? budget.value : previous?.goalTokenBudget,
      }
    },
    isEqual: (a, b) =>
      a.goalAuditorModel === b.goalAuditorModel &&
      a.goalMaxContinuations === b.goalMaxContinuations &&
      a.goalTokenBudget === b.goalTokenBudget,
    save: (next, previous) => {
      const patch: Partial<SessionDefaults> = {}
      if (next.goalAuditorModel !== previous?.goalAuditorModel) patch.goalAuditorModel = next.goalAuditorModel
      if (next.goalMaxContinuations !== previous?.goalMaxContinuations) {
        patch.goalMaxContinuations = next.goalMaxContinuations
      }
      if (next.goalTokenBudget !== previous?.goalTokenBudget) patch.goalTokenBudget = next.goalTokenBudget
      if (Object.keys(patch).length === 0) return
      updateSessionDefaults(patch)
    },
  })

  const updateGoalDraft = useCallback(
    (patch: Partial<GoalDraft>) => {
      setDraft((current) => ({ ...current, ...patch }))
    },
    [setDraft],
  )

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Sessions</h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="sessionPermissionMode">Default permission mode for new sessions</Label>
          <p className="text-sm text-muted-foreground">
            Accept everything answers every "ask" automatically, never overrides deny rules, and only applies to sessions created after the change.
          </p>
        </div>
        <Select
          value={permissionMode}
          onValueChange={(value) => updateSessionDefaults({ permissionMode: value as SessionPermissionMode })}
        >
          <SelectTrigger id="sessionPermissionMode" className="w-full shrink-0 sm:w-40">
            <SelectValue placeholder="Select a mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ask">Ask every time</SelectItem>
            <SelectItem value="auto">Accept everything</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="goalAuditorModel">Goal auditor model</Label>
          <p className="text-sm text-muted-foreground">
            Model that decides whether a session goal is done. Leave empty to use the OpenCode default model.
          </p>
        </div>
        <ModelCombobox
          id="goalAuditorModel"
          ariaLabel="Goal auditor model"
          value={draft.goalAuditorModel}
          onChange={(value) => updateGoalDraft({ goalAuditorModel: value })}
          placeholder="OpenCode default"
          allowCustomValue
          showClear
          className="w-full shrink-0 sm:w-64"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="goalMaxContinuations">Max automatic continuations</Label>
          <p className="text-sm text-muted-foreground">
            How many times a goal may keep the agent working after each audit before it stops.
          </p>
        </div>
        <Input
          id="goalMaxContinuations"
          type="number"
          min={GOAL_MAX_CONTINUATIONS_MIN}
          max={GOAL_MAX_CONTINUATIONS_MAX}
          value={draft.goalMaxContinuations}
          className="w-full shrink-0 sm:w-40"
          onChange={(event) => updateGoalDraft({ goalMaxContinuations: event.target.value })}
          onBlur={commitGoalFields}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="goalTokenBudget">Token budget per goal</Label>
          <p className="text-sm text-muted-foreground">
            Stop a goal once it has spent this many tokens. Leave empty for no limit.
          </p>
        </div>
        <Input
          id="goalTokenBudget"
          type="number"
          min={1}
          value={draft.goalTokenBudget}
          placeholder="No limit"
          className="w-full shrink-0 sm:w-40"
          onChange={(event) => updateGoalDraft({ goalTokenBudget: event.target.value })}
          onBlur={commitGoalFields}
        />
      </div>
    </div>
  )
}
