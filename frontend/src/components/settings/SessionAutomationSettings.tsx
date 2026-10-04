import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
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

  const commitGoalAuditorModel = useCallback(() => {
    const next = goalAuditorModel.trim() || undefined
    if (next === committed.current.goalAuditorModel) return
    committed.current.goalAuditorModel = next
    updateSessionDefaults({ goalAuditorModel: next })
  }, [goalAuditorModel, updateSessionDefaults])

  const commitGoalMaxContinuations = useCallback(() => {
    const value = Number(goalMaxContinuations)
    if (!Number.isInteger(value) || value < GOAL_MAX_CONTINUATIONS_MIN || value > GOAL_MAX_CONTINUATIONS_MAX) return
    if (value === committed.current.goalMaxContinuations) return
    committed.current.goalMaxContinuations = value
    updateSessionDefaults({ goalMaxContinuations: value })
  }, [goalMaxContinuations, updateSessionDefaults])

  const commitGoalTokenBudget = useCallback(() => {
    const next = goalTokenBudget.trim() === '' ? undefined : Number(goalTokenBudget)
    if (next !== undefined && (!Number.isInteger(next) || next <= 0)) return
    if (next === committed.current.goalTokenBudget) return
    committed.current.goalTokenBudget = next
    updateSessionDefaults({ goalTokenBudget: next })
  }, [goalTokenBudget, updateSessionDefaults])

  useEffect(() => {
    const timer = setTimeout(() => {
      commitGoalAuditorModel()
      commitGoalMaxContinuations()
      commitGoalTokenBudget()
    }, AUTOSAVE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [commitGoalAuditorModel, commitGoalMaxContinuations, commitGoalTokenBudget])

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
            Model that decides whether a session goal is done, as provider/model. Leave empty to use the OpenCode default model.
          </p>
        </div>
        <Input
          id="goalAuditorModel"
          value={goalAuditorModel}
          placeholder="provider/model"
          className="w-full shrink-0 sm:w-64"
          onChange={(event) => setGoalAuditorModel(event.target.value)}
          onBlur={commitGoalAuditorModel}
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
          onBlur={commitGoalMaxContinuations}
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
          onBlur={commitGoalTokenBudget}
        />
      </div>
    </div>
  )
}
