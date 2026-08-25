import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderUp, UploadCloud, Loader2 } from 'lucide-react'
import {
  EXCLUDED_OPENCODE_CONFIG_UPLOAD_FILENAMES,
  EXCLUDED_OPENCODE_CONFIG_UPLOAD_SEGMENTS,
  MAX_OPENCODE_CONFIG_DIRECTORY_FILES,
  OPENCODE_CONFIG_UPLOAD_ERRORS,
  PRESERVED_OPENCODE_CONFIG_ENTRIES,
  getCommonUploadRootDirectory,
  isExcludedOpenCodeConfigUploadPath,
  isOpenCodeConfigUploadPath,
  stripUploadRootDirectory,
} from '@opencode-manager/shared/utils'
import { FILE_LIMITS } from '@/config'
import { cn, formatBytes } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDestructiveDialog } from '@/components/ui/confirm-destructive-dialog'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { getOpenCodeApiErrorMessage } from '@/lib/opencode-errors'
import {
  DIRECTORY_INPUT_PROPS,
  openPicker,
  readUploadItemsFromInput,
  useDirectoryDropZone,
  type DirectoryUploadItem,
} from '@/lib/directoryUpload'
import type { OpenCodeImportStatus } from '@/api/types/settings'
import type { ReplaceOpenCodeConfigDirectoryResult } from '@opencode-manager/shared/types'

const MAX_CONFIG_UPLOAD_BYTES = FILE_LIMITS.MAX_UPLOAD_SIZE_BYTES
const EXCLUDED_ENTRIES_DISPLAY = [
  ...EXCLUDED_OPENCODE_CONFIG_UPLOAD_SEGMENTS,
  ...EXCLUDED_OPENCODE_CONFIG_UPLOAD_FILENAMES,
].join(', ')

interface OpenCodeConfigDirectoryUploadProps {
  onReplaced?: () => void
}

export function OpenCodeConfigDirectoryUpload({ onReplaced }: OpenCodeConfigDirectoryUploadProps) {
  const queryClient = useQueryClient()
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [stagedItems, setStagedItems] = useState<DirectoryUploadItem[] | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [lastResult, setLastResult] = useState<ReplaceOpenCodeConfigDirectoryResult | null>(null)
  const deferredConfigInvalidationRef = useRef(false)

  const { data: importStatus } = useQuery<OpenCodeImportStatus>({
    queryKey: ['opencode-import-status'],
    queryFn: () => settingsApi.getOpenCodeImportStatus(),
    staleTime: 30 * 1000,
  })

  const replaceMutation = useMutation({
    mutationFn: (items: DirectoryUploadItem[]) => settingsApi.replaceOpenCodeConfigDirectory(items),
    onSuccess: (result) => {
      onReplaced?.()
      deferredConfigInvalidationRef.current = true
      queryClient.invalidateQueries({ queryKey: ['opencode-import-status'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      setLastResult(result)
      setStagedItems(null)
      setIsConfirmOpen(false)
      showToast.success(
        `Replaced the OpenCode config directory: ${result.filesInstalled.length} files installed, ${result.skippedPaths.length} skipped`,
      )
    },
    onError: (error) => {
      showToast.error(getOpenCodeApiErrorMessage(error, 'Failed to replace the OpenCode config directory'))
    },
  })

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return
      if (event.query.queryKey[0] !== 'health') return
      const health = queryClient.getQueryData<{ opencode?: 'healthy' | 'unhealthy' }>(['health'])
      if (!deferredConfigInvalidationRef.current || health?.opencode !== 'healthy') return
      deferredConfigInvalidationRef.current = false
      invalidateConfigCaches(queryClient)
    })
    return unsubscribe
  }, [queryClient])

  const stageItems = (items: DirectoryUploadItem[]) => {
    if (items.length === 0) {
      showToast.error('No files were provided. Drop a folder containing opencode.json or opencode.jsonc at its root.')
      return
    }

    const commonRoot = getCommonUploadRootDirectory(items.map((item) => item.relativePath))
    const hasRootConfig = items.some((item) =>
      isOpenCodeConfigUploadPath(stripUploadRootDirectory(item.relativePath, commonRoot)),
    )
    if (!hasRootConfig) {
      showToast.error(OPENCODE_CONFIG_UPLOAD_ERRORS.MISSING_ROOT_CONFIG)
      return
    }

    if (items.length > MAX_OPENCODE_CONFIG_DIRECTORY_FILES) {
      showToast.error(OPENCODE_CONFIG_UPLOAD_ERRORS.TOO_MANY_FILES)
      return
    }

    const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0)
    if (totalBytes > MAX_CONFIG_UPLOAD_BYTES) {
      showToast.error(OPENCODE_CONFIG_UPLOAD_ERRORS.EXCEEDS_MAX_UPLOAD_SIZE)
      return
    }

    setLastResult(null)
    setStagedItems(items)
    setIsConfirmOpen(true)
  }

  const { dropZoneRef, isDragging, dropHandlers } = useDirectoryDropZone({
    shouldSkip: (relativePath) => isExcludedOpenCodeConfigUploadPath(relativePath),
    onItems: stageItems,
  })

  const handleFolderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const items = readUploadItemsFromInput(event).filter((item) =>
      !isExcludedOpenCodeConfigUploadPath(item.relativePath),
    )
    stageItems(items)
  }

  const stagedRoot = useMemo(
    () => (stagedItems ? getCommonUploadRootDirectory(stagedItems.map((item) => item.relativePath)) : null),
    [stagedItems],
  )
  const topLevelEntries = useMemo(
    () =>
      stagedItems
        ? Array.from(new Set(
            stagedItems.map((item) => stripUploadRootDirectory(item.relativePath, stagedRoot).split('/')[0]),
          )).sort()
        : [],
    [stagedItems, stagedRoot],
  )
  const stagedTotalBytes = useMemo(
    () => stagedItems?.reduce((sum, item) => sum + item.file.size, 0) ?? 0,
    [stagedItems],
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm sm:text-base">Replace OpenCode Config Directory</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Replace the whole global config directory — the config file, AGENTS.md, agents, commands, skills, plugins and
          anything else it contains — with the contents of a folder. Not just the config file. If the replacement breaks
          startup, upload a working folder again.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div
          ref={dropZoneRef}
          data-testid="config-directory-drop-zone"
          {...dropHandlers}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center',
            isDragging ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Drag and drop your OpenCode config folder here</p>
          <p className="text-xs text-muted-foreground">
            The folder must contain opencode.json or opencode.jsonc at its root. {EXCLUDED_ENTRIES_DISPLAY} entries are
            excluded automatically.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openPicker(folderInputRef)}
            disabled={replaceMutation.isPending}
          >
            {replaceMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <FolderUp className="h-4 w-4 mr-1" />
            )}
            Choose Folder
          </Button>
          <input
            ref={folderInputRef}
            type="file"
            className="sr-only"
            multiple
            disabled={replaceMutation.isPending}
            {...DIRECTORY_INPUT_PROPS}
            onChange={handleFolderChange}
          />
        </div>

        {lastResult && (
          <div className="rounded-lg border border-border p-3">
            <p className="font-medium">Replace complete</p>
            <p className="mt-1 text-muted-foreground">
              {lastResult.filesInstalled.length} file{lastResult.filesInstalled.length === 1 ? '' : 's'} installed
              {lastResult.skippedPaths.length > 0 ? `, ${lastResult.skippedPaths.length} skipped` : ''}
            </p>
            {lastResult.preservedEntries.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                Preserved: {lastResult.preservedEntries.join(', ')}
              </p>
            )}
            {lastResult.executablesRestored.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                Executables restored: {lastResult.executablesRestored.length}
              </p>
            )}
            {lastResult.configSourceFilename !== 'opencode.json' && (
              <p className="mt-1 text-muted-foreground">
                The uploaded {lastResult.configSourceFilename} was installed as opencode.json.
              </p>
            )}
          </div>
        )}

        <ConfirmDestructiveDialog
          open={isConfirmOpen}
          onOpenChange={(open) => {
            setIsConfirmOpen(open)
            if (!open) setStagedItems(null)
          }}
          onConfirm={() => {
            if (stagedItems) replaceMutation.mutate(stagedItems)
          }}
          onCancel={() => {
            setIsConfirmOpen(false)
            setStagedItems(null)
          }}
          title="Replace OpenCode Config Directory?"
          description={
            <div className="space-y-2">
              <p>Replace the OpenCode config directory at:</p>
              <p className="font-mono text-xs break-all">
                {importStatus?.workspaceConfigDirectory ?? 'Unavailable'}
              </p>
              <p>
                {stagedItems?.length ?? 0} files ({formatBytes(stagedTotalBytes)})
              </p>
              <div>
                <p className="font-medium">Top-level entries:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {topLevelEntries.map((entry) => (
                    <li key={entry} className="font-mono text-xs">
                      {entry}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          }
          warning={`Every file currently in the destination directory except ${PRESERVED_OPENCODE_CONFIG_ENTRIES.join(', ')} will be deleted.`}
          confirmLabel="Replace and Restart"
          pendingLabel="Replacing..."
          isPending={replaceMutation.isPending}
        />
      </CardContent>
    </Card>
  )
}
