import { useState, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2, Eye, Loader2, AlertTriangle } from 'lucide-react'
import { DEFAULT_SESSION_PRUNE_CONFIG } from '@opencode-manager/shared'
import { showToast } from '@/lib/toast'
import { apiClient } from '@/api/client'
import { DeleteDialog } from '@/components/ui/delete-dialog'

interface PrunePreviewSession {
  id: string
  title: string
  directory: string
  lastUpdated: string
  age: number
}

interface PrunePreviewResponse {
  sessionsToDelete: PrunePreviewSession[]
  count: number
  cutoffDays: number
  cutoffDate: string
}

interface PruneResponse {
  success: boolean
  deleted: number
  failed: number
  failedSessions: Array<{ id: string; error: string }>
  cutoffDays: number
  cutoffDate: string
}

export function SessionPruneSettings() {
  const { preferences, updateSettings } = useSettings()
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isPruning, setIsPruning] = useState(false)
  const [previewData, setPreviewData] = useState<PrunePreviewResponse | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  
  const pruneConfig = preferences?.sessionPrune ?? DEFAULT_SESSION_PRUNE_CONFIG

  const handleChange = (updates: Partial<typeof pruneConfig>) => {
    updateSettings({
      sessionPrune: {
        ...pruneConfig,
        ...updates,
      },
    })
  }

  const handlePreview = useCallback(async () => {
    setIsPreviewing(true)
    setPreviewData(null)
    try {
      const response = await apiClient.get<PrunePreviewResponse>(`/sessions/prune/preview?days=${pruneConfig.intervalDays}`)
      const data = response.data
      setPreviewData(data)
      
      if (data.count === 0) {
        showToast.success('No sessions to prune')
      } else {
        showToast.info(`Found ${data.count} session${data.count === 1 ? '' : 's'} older than ${pruneConfig.intervalDays} days`)
      }
    } catch (error) {
      console.error('Preview prune error:', error)
      showToast.error('Failed to preview sessions for pruning')
    } finally {
      setIsPreviewing(false)
    }
  }, [pruneConfig.intervalDays])

  const handlePrune = useCallback(async () => {
    setIsPruning(true)
    try {
      const response = await apiClient.post<PruneResponse>('/sessions/prune', { days: pruneConfig.intervalDays })
      const data = response.data
      
      if (data.success) {
        showToast.success(`Deleted ${data.deleted} session${data.deleted === 1 ? '' : 's'}`)
        
        // Update lastPrunedAt
        handleChange({ lastPrunedAt: Date.now() })
        
        // Clear preview data
        setPreviewData(null)
        
        if (data.failed > 0) {
          showToast.warning(`Failed to delete ${data.failed} session${data.failed === 1 ? '' : 's'}`)
        }
      } else {
        showToast.error('Failed to prune sessions')
      }
    } catch (error) {
      console.error('Prune sessions error:', error)
      showToast.error('Failed to prune sessions')
    } finally {
      setIsPruning(false)
      setShowConfirmDialog(false)
    }
  }, [pruneConfig.intervalDays])

  const formatLastPruned = () => {
    if (!pruneConfig.lastPrunedAt) return 'Never'
    const date = new Date(pruneConfig.lastPrunedAt)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6">Session Cleanup</h2>
      
      <div className="space-y-6">
        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="autoPruneEnabled" className="text-base">Auto-prune Sessions</Label>
            <p className="text-sm text-muted-foreground">
              Automatically delete old OpenCode sessions on startup
            </p>
          </div>
          <Switch
            id="autoPruneEnabled"
            checked={pruneConfig.enabled}
            onCheckedChange={(checked) => handleChange({ enabled: checked })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pruneIntervalDays">Delete sessions older than (days)</Label>
          <Input
            id="pruneIntervalDays"
            type="number"
            min={1}
            max={365}
            value={pruneConfig.intervalDays}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10)
              if (!isNaN(value) && value >= 1 && value <= 365) {
                handleChange({ intervalDays: value })
              }
            }}
            className="w-32 bg-background border-border text-foreground"
          />
          <p className="text-sm text-muted-foreground">
            Sessions not updated within this period will be deleted (1-365 days)
          </p>
        </div>

        <div className="rounded-lg border border-border p-4 bg-muted/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-medium text-foreground">Last cleaned</p>
              <p className="text-sm text-muted-foreground">{formatLastPruned()}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreview}
                disabled={isPreviewing || isPruning}
              >
                {isPreviewing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-1" />
                    Preview
                  </>
                )}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowConfirmDialog(true)}
                disabled={isPreviewing || isPruning}
              >
                {isPruning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-1" />
                    Prune Now
                  </>
                )}
              </Button>
            </div>
          </div>
          
          {previewData && previewData.count > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                {previewData.count} session{previewData.count === 1 ? '' : 's'} will be deleted
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {previewData.sessionsToDelete.slice(0, 10).map((session) => (
                  <div key={session.id} className="text-xs text-muted-foreground bg-background rounded p-2">
                    <span className="font-medium">{session.title}</span>
                    <span className="mx-2">-</span>
                    <span>{session.age} days old</span>
                    <div className="truncate opacity-70">{session.directory}</div>
                  </div>
                ))}
                {previewData.count > 10 && (
                  <p className="text-xs text-muted-foreground text-center py-1">
                    ...and {previewData.count - 10} more
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <DeleteDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        onConfirm={handlePrune}
        onCancel={() => setShowConfirmDialog(false)}
        title="Delete Old Sessions?"
        description={`This will permanently delete all OpenCode sessions older than ${pruneConfig.intervalDays} days. This action cannot be undone.`}
        isDeleting={isPruning}
      />
    </div>
  )
}
