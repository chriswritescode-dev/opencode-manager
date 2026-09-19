import { useState, useEffect, useMemo } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { showToast } from '@/lib/toast'
import { BLOCKED_SERVER_ENV_KEYS, DEFAULT_SERVER_ENV_VARS } from '@/api/types/settings'
import { SettingsDisclosure } from './SettingsDisclosure'

interface EnvVar {
  key: string
  value: string
}

export function ServerEnvVarsSettings() {
  const { preferences, updateSettingsAsync, isUpdating } = useSettings()
  const [isOpen, setIsOpen] = useState(false)
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [disabledDefaultKeys, setDisabledDefaultKeys] = useState<string[]>([])
  const [needsRestart, setNeedsRestart] = useState(false)

  useEffect(() => {
    setEnvVars(preferences?.serverEnvVars ?? [])
    setDisabledDefaultKeys(preferences?.disabledDefaultServerEnvVars ?? [])
  }, [preferences?.disabledDefaultServerEnvVars, preferences?.serverEnvVars])

  const blockedSet = useMemo(() => new Set<string>(BLOCKED_SERVER_ENV_KEYS), [])

  const blockedKeys = useMemo(
    () => envVars
      .map((envVar) => envVar.key.trim())
      .filter((key) => key.length > 0 && blockedSet.has(key)),
    [envVars, blockedSet],
  )

  const disabledDefaultSet = useMemo(() => new Set(disabledDefaultKeys), [disabledDefaultKeys])
  const enabledDefaultCount = DEFAULT_SERVER_ENV_VARS.filter((envVar) => !disabledDefaultSet.has(envVar.key)).length

  const handleDefaultToggle = (key: string, enabled: boolean) => {
    setDisabledDefaultKeys((prev) => enabled
      ? prev.filter((disabledKey) => disabledKey !== key)
      : [...new Set([...prev, key])])
  }

  const handleAdd = () => {
    setEnvVars((prev) => [...prev, { key: '', value: '' }])
  }

  const handleRemove = (index: number) => {
    setEnvVars((prev) => prev.filter((_, i) => i !== index))
  }

  const handleChange = (index: number, field: keyof EnvVar, value: string) => {
    setEnvVars((prev) => prev.map((envVar, i) => (i === index ? { ...envVar, [field]: value } : envVar)))
  }

  const handleSave = async () => {
    if (blockedKeys.length > 0) return

    const filtered = envVars.filter((envVar) => envVar.key.trim() !== '')

    try {
      await updateSettingsAsync({
        serverEnvVars: filtered,
        disabledDefaultServerEnvVars: disabledDefaultKeys,
      })
      setNeedsRestart(true)
      showToast.success('Environment variables saved')
    } catch {
      showToast.error('Failed to save environment variables')
    }
  }

  return (
    <SettingsDisclosure
      title="Server Environment Variables"
      isOpen={isOpen}
      onToggle={() => setIsOpen((value) => !value)}
      contentClassName="space-y-3"
      meta={
        <Badge variant="outline" className="text-xs">
          {enabledDefaultCount + (preferences?.serverEnvVars ?? []).length}
        </Badge>
      }
    >
      {needsRestart && (
        <Alert>
          <RotateCcw className="h-4 w-4" />
          <AlertDescription>
            Restart the OpenCode server to apply environment variable changes.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <div className="rounded-md bg-muted/20 p-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Default variables</div>
          {DEFAULT_SERVER_ENV_VARS.map((envVar) => {
            const isEnabled = !disabledDefaultSet.has(envVar.key)

            return (
              <div key={envVar.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs truncate">{envVar.key}={envVar.value}</div>
                  <p className="text-xs text-muted-foreground">
                    Required for OpenCode workspace listing and deletion.
                  </p>
                </div>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) => handleDefaultToggle(envVar.key, checked)}
                  aria-label={`Toggle ${envVar.key}`}
                />
              </div>
            )
          })}
        </div>

        {envVars.map((envVar, index) => {
          const isBlocked = blockedSet.has(envVar.key.trim())

          return (
            <div key={index} className="flex gap-2 items-center">
              <div className="flex-1 flex gap-2">
                <Input
                  value={envVar.key}
                  onChange={(event) => handleChange(index, 'key', event.target.value)}
                  placeholder="VARIABLE_NAME"
                  className={`font-mono ${isBlocked ? 'border-destructive' : ''}`}
                />
                <Input
                  value={envVar.value}
                  onChange={(event) => handleChange(index, 'value', event.target.value)}
                  placeholder="value"
                  className="font-mono"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleRemove(index)}
                className="shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )
        })}
        {blockedKeys.length > 0 && (
          <p className="text-xs text-destructive">
            Reserved keys cannot be overridden: {blockedKeys.join(', ')}
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          <Plus className="h-3 w-3 mr-1" />
          Add variable
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isUpdating || blockedKeys.length > 0}
        >
          {isUpdating ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Variables are injected into the OpenCode server process at startup.
        Changes require a server restart.
      </p>
    </SettingsDisclosure>
  )
}
