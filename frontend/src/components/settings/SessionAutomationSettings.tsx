import { useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DEFAULT_SESSION_DEFAULTS,
  type SessionDefaults,
  type SessionPermissionMode,
} from '@opencode-manager/shared/schemas'

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
    </div>
  )
}
