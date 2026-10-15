import { useEffect, useState } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useServerHealth } from '@/hooks/useServerHealth'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Box, RotateCcw } from 'lucide-react'
import { showToast } from '@/lib/toast'
import { FetchError } from '@/api/fetchWrapper'
import { SettingsDisclosure } from './SettingsDisclosure'
import {
  DEFAULT_SANDBOX_IDLE_STOP_MINUTES,
  DEFAULT_SANDBOX_MAX_RUNNING_VMS,
  SandboxPreferencesSchema,
  SessionSandboxResourcesSchema,
  type SandboxPreferences,
} from '@opencode-manager/shared/schemas'

const cpusSchema = SessionSandboxResourcesSchema.shape.cpus
const memoryMibSchema = SessionSandboxResourcesSchema.shape.memoryMib
const idleStopSchema = SandboxPreferencesSchema.shape.idleStopMinutes.unwrap()
const maxRunningVmsSchema = SandboxPreferencesSchema.shape.maxRunningVms.unwrap()

const SANDBOX_CPUS_MIN = cpusSchema.minValue ?? 1
const SANDBOX_CPUS_MAX = cpusSchema.maxValue ?? 64
const SANDBOX_MEMORY_GIB_MIN = (memoryMibSchema.minValue ?? 1024) / 1024
const SANDBOX_MEMORY_GIB_MAX = (memoryMibSchema.maxValue ?? 1048576) / 1024
const SANDBOX_IDLE_MINUTES_MIN = idleStopSchema.minValue ?? 1
const SANDBOX_IDLE_MINUTES_MAX = idleStopSchema.maxValue ?? 1440
const SANDBOX_MAX_VMS_MIN = maxRunningVmsSchema.minValue ?? 1
const SANDBOX_MAX_VMS_MAX = maxRunningVmsSchema.maxValue ?? 32

interface SandboxDraft {
  cpus: string
  memoryGib: string
  idleStopMinutes: string
  maxRunningVms: string
}

function toDraft(sandbox: SandboxPreferences | undefined): SandboxDraft {
  return {
    cpus: sandbox?.cpus !== undefined ? String(sandbox.cpus) : '',
    memoryGib: sandbox?.memoryMib !== undefined ? String(sandbox.memoryMib / 1024) : '',
    idleStopMinutes: String(sandbox?.idleStopMinutes ?? DEFAULT_SANDBOX_IDLE_STOP_MINUTES),
    maxRunningVms: String(sandbox?.maxRunningVms ?? DEFAULT_SANDBOX_MAX_RUNNING_VMS),
  }
}

export function SandboxSettings() {
  const { preferences, updateSettingsAsync, isUpdating } = useSettings()
  const { data: health } = useServerHealth()

  const sandbox = health?.sandbox
  const isAvailable = sandbox?.available === true
  const sandboxPreferences = preferences?.sandbox
  const enabled = sandboxPreferences?.enabled ?? false
  const gitCredentials = sandboxPreferences?.gitCredentials ?? false
  const defaultForNewSessions = sandboxPreferences?.defaultForNewSessions ?? true

  const [draft, setDraft] = useState<SandboxDraft>(() => toDraft(sandboxPreferences))

  useEffect(() => {
    setDraft(toDraft(sandboxPreferences))
  }, [sandboxPreferences])

  const saveSandbox = async (patch: Partial<SandboxPreferences>, message: string) => {
    try {
      const baseSandbox: SandboxPreferences = { ...sandboxPreferences, enabled: sandboxPreferences?.enabled ?? false }
      await updateSettingsAsync({ sandbox: { ...baseSandbox, ...patch } })
      showToast.success(message)
    } catch (error) {
      showToast.error(error instanceof FetchError ? error.message : 'Failed to update sandbox preference')
    }
  }

  const handleToggle = (next: boolean) =>
    saveSandbox(
      { enabled: next, gitCredentials, defaultForNewSessions },
      next ? 'Sandboxing enabled' : 'Sandboxing disabled',
    )

  const handleGitCredentialsToggle = (next: boolean) =>
    saveSandbox(
      { enabled, gitCredentials: next, defaultForNewSessions },
      next ? 'Git credentials will be forwarded into the sandbox' : 'Git credential forwarding disabled',
    )

  const handleDefaultForNewSessionsToggle = (next: boolean) =>
    saveSandbox(
      { enabled, gitCredentials, defaultForNewSessions: next },
      next ? 'New sessions will start sandboxed' : 'New sessions will start unsandboxed',
    )

  const commitCpus = () => {
    const trimmed = draft.cpus.trim()
    if (trimmed === '') {
      void saveSandbox({ cpus: undefined }, 'Default CPUs reset to the server default')
      return
    }
    const value = Number(trimmed)
    if (!Number.isInteger(value) || !cpusSchema.safeParse(value).success) {
      showToast.error(`Default CPUs must be a whole number from ${SANDBOX_CPUS_MIN} to ${SANDBOX_CPUS_MAX}`)
      setDraft((current) => ({
        ...current,
        cpus: sandboxPreferences?.cpus !== undefined ? String(sandboxPreferences.cpus) : '',
      }))
      return
    }
    void saveSandbox({ cpus: value }, 'Default CPUs saved')
  }

  const commitMemory = () => {
    const trimmed = draft.memoryGib.trim()
    if (trimmed === '') {
      void saveSandbox({ memoryMib: undefined }, 'Default memory reset to the server default')
      return
    }
    const gib = Number(trimmed)
    const memoryMib = Math.round(gib * 1024)
    if (!Number.isFinite(gib) || !memoryMibSchema.safeParse(memoryMib).success) {
      showToast.error(
        `Default memory must be between ${SANDBOX_MEMORY_GIB_MIN} and ${SANDBOX_MEMORY_GIB_MAX} GiB`,
      )
      setDraft((current) => ({
        ...current,
        memoryGib: sandboxPreferences?.memoryMib !== undefined ? String(sandboxPreferences.memoryMib / 1024) : '',
      }))
      return
    }
    void saveSandbox({ memoryMib }, 'Default memory saved')
  }

  const commitIdleStopMinutes = () => {
    const value = Number(draft.idleStopMinutes.trim())
    if (!Number.isInteger(value) || !idleStopSchema.safeParse(value).success) {
      showToast.error(
        `Idle stop must be a whole number from ${SANDBOX_IDLE_MINUTES_MIN} to ${SANDBOX_IDLE_MINUTES_MAX} minutes`,
      )
      setDraft((current) => ({
        ...current,
        idleStopMinutes: String(sandboxPreferences?.idleStopMinutes ?? DEFAULT_SANDBOX_IDLE_STOP_MINUTES),
      }))
      return
    }
    void saveSandbox({ idleStopMinutes: value }, 'Idle removal timeout saved')
  }

  const commitMaxRunningVms = () => {
    const value = Number(draft.maxRunningVms.trim())
    if (!Number.isInteger(value) || !maxRunningVmsSchema.safeParse(value).success) {
      showToast.error(
        `Max running sandbox VMs must be a whole number from ${SANDBOX_MAX_VMS_MIN} to ${SANDBOX_MAX_VMS_MAX}`,
      )
      setDraft((current) => ({
        ...current,
        maxRunningVms: String(sandboxPreferences?.maxRunningVms ?? DEFAULT_SANDBOX_MAX_RUNNING_VMS),
      }))
      return
    }
    void saveSandbox({ maxRunningVms: value }, 'Max running sandbox VMs saved')
  }

  const parsedMaxRunningVms = Number(draft.maxRunningVms.trim())
  const helperMaxRunningVms =
    Number.isInteger(parsedMaxRunningVms) && maxRunningVmsSchema.safeParse(parsedMaxRunningVms).success
      ? parsedMaxRunningVms
      : DEFAULT_SANDBOX_MAX_RUNNING_VMS

  return (
    <SettingsDisclosure
      title="Sandbox"
      icon={<Box className="h-4 w-4 shrink-0 text-muted-foreground" />}
      meta={
        sandbox?.msbVersion ? (
          <Badge variant="outline" className="text-xs shrink-0">
            msb {sandbox.msbVersion}
          </Badge>
        ) : undefined
      }
      contentClassName="space-y-3"
    >
      <div className="grid gap-x-6 gap-y-3 @min-[1000px]:grid-cols-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm text-muted-foreground">
              Run OpenCode agent commands inside microVMs for isolation.
            </p>
            {sandbox === undefined ? (
              <p className="text-xs text-muted-foreground">Checking sandbox availability...</p>
            ) : !isAvailable && (
              <p className="text-xs text-destructive">
                {sandbox.reason ?? 'Sandboxing is unavailable on this host.'}
              </p>
            )}
          </div>
          <Switch
            checked={enabled}
            disabled={isUpdating || (!isAvailable && !enabled)}
            onCheckedChange={handleToggle}
            aria-label="Toggle sandbox"
          />
        </div>

        <div className="flex items-start justify-between gap-3 border-t pt-3 @min-[1000px]:border-t-0 @min-[1000px]:pt-0">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold">Git credentials in sandbox</p>
            <p className="text-xs text-muted-foreground">
              Forward git credentials into the microVM so sandboxed git and gh commands can authenticate. A
              prompt-injected agent can exfiltrate any credential you forward.
            </p>
          </div>
          <Switch
            checked={gitCredentials}
            disabled={isUpdating || !enabled}
            onCheckedChange={handleGitCredentialsToggle}
            aria-label="Toggle git credentials in sandbox"
          />
        </div>

        {enabled && (
          <>
            <div className="flex items-start justify-between gap-3 border-t pt-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold">Sandbox new sessions by default</p>
                <p className="text-xs text-muted-foreground">
                  Start new sessions with command sandboxing enabled. Applies immediately and can be changed per
                  session from the composer.
                </p>
              </div>
              <Switch
                checked={defaultForNewSessions}
                disabled={isUpdating}
                onCheckedChange={handleDefaultForNewSessionsToggle}
                aria-label="Toggle sandbox for new sessions"
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Label htmlFor="sandboxDefaultCpus" className="min-w-0 text-sm font-semibold">
                Default CPUs
              </Label>
              <Input
                id="sandboxDefaultCpus"
                type="number"
                min={SANDBOX_CPUS_MIN}
                max={SANDBOX_CPUS_MAX}
                step={1}
                inputMode="numeric"
                placeholder="Server default"
                className="w-36 shrink-0"
                disabled={isUpdating}
                value={draft.cpus}
                onChange={(event) => setDraft((current) => ({ ...current, cpus: event.target.value }))}
                onBlur={commitCpus}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Label htmlFor="sandboxDefaultMemory" className="min-w-0 text-sm font-semibold">
                Default memory (GiB)
              </Label>
              <Input
                id="sandboxDefaultMemory"
                type="number"
                min={SANDBOX_MEMORY_GIB_MIN}
                max={SANDBOX_MEMORY_GIB_MAX}
                step={0.5}
                placeholder="Server default"
                className="w-36 shrink-0"
                disabled={isUpdating}
                value={draft.memoryGib}
                onChange={(event) => setDraft((current) => ({ ...current, memoryGib: event.target.value }))}
                onBlur={commitMemory}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Label htmlFor="sandboxIdleStopMinutes" className="min-w-0 text-sm font-semibold">
                Remove idle sandbox VMs after (minutes)
              </Label>
              <Input
                id="sandboxIdleStopMinutes"
                type="number"
                min={SANDBOX_IDLE_MINUTES_MIN}
                max={SANDBOX_IDLE_MINUTES_MAX}
                step={1}
                inputMode="numeric"
                className="w-36 shrink-0"
                disabled={isUpdating}
                value={draft.idleStopMinutes}
                onChange={(event) => setDraft((current) => ({ ...current, idleStopMinutes: event.target.value }))}
                onBlur={commitIdleStopMinutes}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Label htmlFor="sandboxMaxRunningVms" className="min-w-0 text-sm font-semibold">
                Max running sandbox VMs
              </Label>
              <Input
                id="sandboxMaxRunningVms"
                type="number"
                min={SANDBOX_MAX_VMS_MIN}
                max={SANDBOX_MAX_VMS_MAX}
                step={1}
                inputMode="numeric"
                className="w-36 shrink-0"
                disabled={isUpdating}
                value={draft.maxRunningVms}
                onChange={(event) => setDraft((current) => ({ ...current, maxRunningVms: event.target.value }))}
                onBlur={commitMaxRunningVms}
              />
            </div>

            <p className="text-xs text-muted-foreground @min-[1000px]:col-span-2">
              Each sandboxed session gets its own microVM that mounts only that session's repository. A VM unused
              for this long, or whose session's sandbox is turned off, is removed together with its Docker data, so
              installed packages and Docker images are lost; the next sandboxed command creates a fresh VM. At most{' '}
              {helperMaxRunningVms} run at once. CPU and memory changes apply on the session's next sandboxed command
              and recreate its VM (the Docker data volume is kept).
            </p>
          </>
        )}
      </div>

      {health?.opencodeRestartPending && (
        <Alert>
          <RotateCcw className="h-4 w-4" />
          <AlertDescription>
            Restart the OpenCode server to apply changes to sandbox support or git credentials. Per-session
            sandbox toggles apply immediately.
          </AlertDescription>
        </Alert>
      )}
    </SettingsDisclosure>
  )
}
