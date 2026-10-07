import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '@/hooks/useSettings'
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

const AUTOSAVE_DELAY_MS = 800

export function SessionAutomationSettings() {
  const { preferences, updateSettings } = useSettings()
  const sessionDefaults = preferences?.sessionDefaults
  const permissionMode = sessionDefaults?.permissionMode ?? DEFAULT_SESSION_DEFAULTS.permissionMode

  const [goalAuditorModel, setGoalAuditorModel] = useState(sessionDefaults?.goalAuditorModel ?? '')
  const [goalMaxContinuations, setGoalMaxContinuations] = useState(
    String(sessionDefaults?.goalMaxContinuations ?? DEFAULT_SESSION_DEFAULTS.goalMaxContinuations),
  )
  const [goalTokenBudget, setGoalTokenBudget] = useState(
    sessionDefaults?.goalTokenBudget !== undefined ? String(sessionDefaults.goalTokenBudget) : '',
  )

  const committed = useRef({
    goalAuditorModel: sessionDefaults?.goalAuditorModel,
    goalMaxContinuations: sessionDefaults?.goalMaxContinuations ?? DEFAULT_SESSION_DEFAULTS.goalMaxContinuations,
    goalTokenBudget: sessionDefaults?.goalTokenBudget,
  })

  useEffect(() => {
    setGoalAuditorModel(sessionDefaults?.goalAuditorModel ?? '')
    setGoalMaxContinuations(
      String(sessionDefaults?.goalMaxContinuations ?? DEFAULT_SESSION_DEFAULTS.goalMaxContinuations),
    )
    setGoalTokenBudget(
      sessionDefaults?.goalTokenBudget !== undefined ? String(sessionDefaults.goalTokenBudget) : '',
    )
    committed.current = {
      goalAuditorModel: sessionDefaults?.goalAuditorModel,
      goalMaxContinuations: sessionDefaults?.goalMaxContinuations ?? DEFAULT_SESSION_DEFAULTS.goalMaxContinuations,
      goalTokenBudget: sessionDefaults?.goalTokenBudget,
    }
  }, [sessionDefaults])

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

  const commitGoalFields = useCallback(() => {
    const patch: Partial<SessionDefaults> = {}

    const nextAuditorModel = goalAuditorModel.trim() || undefined
    if (nextAuditorModel !== committed.current.goalAuditorModel) {
      committed.current.goalAuditorModel = nextAuditorModel
      patch.goalAuditorModel = nextAuditorModel
    }

    const nextMaxContinuations = Number(goalMaxContinuations)
    if (
      Number.isInteger(nextMaxContinuations) &&
      nextMaxContinuations >= GOAL_MAX_CONTINUATIONS_MIN &&
      nextMaxContinuations <= GOAL_MAX_CONTINUATIONS_MAX &&
      nextMaxContinuations !== committed.current.goalMaxContinuations
    ) {
      committed.current.goalMaxContinuations = nextMaxContinuations
      patch.goalMaxContinuations = nextMaxContinuations
    }

    const nextTokenBudget = goalTokenBudget.trim() === '' ? undefined : Number(goalTokenBudget)
    const tokenBudgetValid = nextTokenBudget === undefined || (Number.isInteger(nextTokenBudget) && nextTokenBudget > 0)
    if (tokenBudgetValid && nextTokenBudget !== committed.current.goalTokenBudget) {
      committed.current.goalTokenBudget = nextTokenBudget
      patch.goalTokenBudget = nextTokenBudget
    }

    if (Object.keys(patch).length === 0) return
    updateSessionDefaults(patch)
  }, [goalAuditorModel, goalMaxContinuations, goalTokenBudget, updateSessionDefaults])

  useEffect(() => {
    const timer = setTimeout(() => {
      commitGoalFields()
    }, AUTOSAVE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [commitGoalFields])

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
          value={goalAuditorModel}
          onChange={setGoalAuditorModel}
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
          value={goalMaxContinuations}
          className="w-full shrink-0 sm:w-40"
          onChange={(event) => setGoalMaxContinuations(event.target.value)}
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
          value={goalTokenBudget}
          placeholder="No limit"
          className="w-full shrink-0 sm:w-40"
          onChange={(event) => setGoalTokenBudget(event.target.value)}
          onBlur={commitGoalFields}
        />
      </div>
    </div>
  )
}
