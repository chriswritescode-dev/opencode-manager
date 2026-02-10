import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Check, Download } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'

interface VersionSelectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VersionSelectDialog({ open, onOpenChange }: VersionSelectDialogProps) {
  const queryClient = useQueryClient()
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['opencode-versions'],
    queryFn: () => settingsApi.getOpenCodeVersions(),
    enabled: open,
    staleTime: 60000,
  })

  const installMutation = useMutation({
    mutationFn: (version: string) => settingsApi.installOpenCodeVersion(version),
    onSuccess: (result) => {
      if (result.newVersion) {
        queryClient.setQueryData(['health'], (old: Record<string, unknown> | undefined) => {
          if (!old) return old
          return { ...old, opencodeVersion: result.newVersion }
        })
      }
      queryClient.invalidateQueries({ queryKey: ['opencode-versions'] })
      invalidateConfigCaches(queryClient)
      showToast.success(result.message)
      onOpenChange(false)
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['opencode-versions'] })
      invalidateConfigCaches(queryClient)
      
      if (error && typeof error === 'object' && 'response' in error) {
        const response = (error as { response?: { data?: { recovered?: boolean; recoveryMessage?: string; newVersion?: string } } }).response
        const data = response?.data
        
        if (data?.recovered) {
          queryClient.setQueryData(['health'], (old: Record<string, unknown> | undefined) => {
            if (!old) return old
            return { ...old, opencodeVersion: data.newVersion }
          })
          showToast.success(`Install failed but server recovered at v${data.newVersion}`)
        } else {
          showToast.error(data?.recoveryMessage || 'Failed to install version')
        }
      } else {
        showToast.error('Failed to install version')
      }
    },
  })

  const handleInstall = () => {
    if (!selectedVersion) return
    showToast.loading(`Installing OpenCode v${selectedVersion}...`, { id: 'install-version' })
    installMutation.mutate(selectedVersion, {
      onSettled: () => {
        showToast.dismiss('install-version')
      }
    })
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md z-[200]" overlayClassName="z-[200]">
        <DialogHeader>
          <DialogTitle>Select OpenCode Version</DialogTitle>
          <DialogDescription>
            Choose a version to install. Current version: {data?.currentVersion ? `v${data.currentVersion}` : 'Unknown'}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-center py-8 text-red-500">
            Failed to fetch versions
          </div>
        )}

        {data && (
          <>
            <div className="h-[300px] overflow-y-auto pr-2">
              <div className="space-y-2">
                {data.versions.map((release) => {
                  const isCurrent = release.version === data.currentVersion
                  const isSelected = release.version === selectedVersion

                  return (
                    <button
                      key={release.version}
                      onClick={() => setSelectedVersion(isCurrent ? null : release.version)}
                      disabled={isCurrent || installMutation.isPending}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : isCurrent
                            ? 'border-green-500/50 bg-green-500/10 cursor-default'
                            : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            v{release.version}
                            {isCurrent && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-400">
                                Current
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {formatDate(release.publishedAt)}
                          </div>
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-primary" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={installMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleInstall}
                disabled={!selectedVersion || installMutation.isPending}
                className="min-w-[120px]"
              >
                {installMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {selectedVersion ? `Install` : 'Select version'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
