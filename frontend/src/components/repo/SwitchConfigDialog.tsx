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
              <Loader2 className="w-4 h-4 animate-spin text-info" />
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
                        <span className="ml-2 text-xs text-info">(default)</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded p-3 border border-destructive/30 bg-destructive/10">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
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
