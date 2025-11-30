import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertCircle, Loader2 } from 'lucide-react'
import { settingsApi } from '@/api/settings'
import * as reposApi from '@/api/repos'
import type { OpenCodeConfig } from '@/api/types/settings'

interface SwitchConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: number
  currentConfigName?: string
  onConfigSwitched: (configName: string) => void
}

export function SwitchConfigDialog({
  open,
  onOpenChange,
  repoId,
  currentConfigName,
  onConfigSwitched,
}: SwitchConfigDialogProps) {
  const [configs, setConfigs] = useState<OpenCodeConfig[]>([])
  const [selectedConfig, setSelectedConfig] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    const fetchConfigs = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await settingsApi.getOpenCodeConfigs()
        setConfigs(response.configs || [])
        setSelectedConfig(currentConfigName || '')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load configs')
      } finally {
        setLoading(false)
      }
    }

    fetchConfigs()
  }, [open, currentConfigName])

  const handleSwitch = async () => {
    if (!selectedConfig) {
      setError('Please select a config')
      return
    }

    if (selectedConfig === currentConfigName) {
      onOpenChange(false)
      return
    }

    try {
      setSwitching(true)
      setError(null)
      await reposApi.switchRepoConfig(repoId, selectedConfig)
      onConfigSwitched(selectedConfig)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch config')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Switch Config</DialogTitle>
          <DialogDescription>
            Select a different OpenCode configuration for this repository
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {currentConfigName && (
            <div className="text-sm text-muted-foreground">
              Current config: <span className="text-foreground font-semibold">{currentConfigName}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
              <span className="ml-2 text-sm text-muted-foreground">Loading configs...</span>
            </div>
          ) : configs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No configs available</div>
          ) : (
            <Select value={selectedConfig} onValueChange={setSelectedConfig}>
              <SelectTrigger className="bg-background border-border text-foreground">
                <SelectValue placeholder="Select a config" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {configs.map((config) => (
                  <SelectItem key={config.id} value={config.name}>
                    <div className="flex items-center gap-2">
                      {config.name}
                      {config.isDefault && (
                        <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">(default)</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 dark:bg-red-900/20 border border-red-500/30 dark:border-red-800/50 rounded p-3">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border hover:bg-accent"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSwitch}
              disabled={!selectedConfig || switching || selectedConfig === currentConfigName}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {switching ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Switching...
                </>
              ) : (
                'Switch Config'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
