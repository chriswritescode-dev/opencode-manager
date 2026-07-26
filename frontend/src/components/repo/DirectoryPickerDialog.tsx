import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { browseDirectory } from '@/api/filesystem'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { FetchError } from '@/api/fetchWrapper'
import { Folder, FolderGit2, ChevronUp, Loader2, FolderX } from 'lucide-react'

interface DirectoryPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  title?: string
}

export function DirectoryPickerDialog({ open, onOpenChange, onSelect, title = 'Select Folder' }: DirectoryPickerDialogProps) {
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (open) {
      setCurrentPath(undefined)
    }
  }, [open])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['filesystem-browse', currentPath],
    queryFn: () => browseDirectory(currentPath),
    enabled: open,
    retry: false,
  })

  const isDisabled = error instanceof FetchError && error.statusCode === 501

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path)
  }, [])

  const handleSelect = useCallback(() => {
    if (data?.path) {
      onSelect(data.path)
      onOpenChange(false)
    }
  }, [data?.path, onSelect, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="content-start gap-0 sm:max-w-[560px] sm:max-h-[80vh]">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2 h-fit">
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </DialogHeader>

        <div className="px-4 sm:px-6 pb-2">
          <p className="truncate rounded bg-muted px-3 py-2 text-xs text-muted-foreground" title={data?.path}>
            {data?.path ?? 'Loading...'}
          </p>
        </div>

        <div className="mx-4 sm:mx-6 mb-4 min-h-[240px] flex-1 overflow-y-auto rounded border border-border bg-muted">
          {isLoading ? (
            <div className="flex h-[240px] items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isDisabled ? (
            <div className="flex h-[240px] flex-col items-center justify-center gap-3 px-6 text-center">
              <FolderX className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-foreground">Folder browsing is not enabled</p>
              <p className="text-xs text-muted-foreground">
                Ask your administrator to set <code className="rounded bg-accent px-1 py-0.5 text-foreground">REPO_BROWSE_ROOT</code> in the
                server environment, then enter the path manually for now.
              </p>
            </div>
          ) : isError ? (
            <div className="flex h-[240px] items-center justify-center px-4 text-center text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to load directory'}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data && !data.isRoot && data.parentPath !== null && (
                <li>
                  <button
                    type="button"
                    onClick={() => navigateTo(data.parentPath!)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-accent"
                  >
                    <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ..
                  </button>
                </li>
              )}
              {data?.entries.length === 0 && (
                <li className="px-3 py-4 text-center text-sm text-muted-foreground">No subfolders</li>
              )}
              {data?.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => navigateTo(entry.path)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent"
                  >
                    {entry.isGitRepo ? (
                      <FolderGit2 className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{entry.name}</span>
                    {entry.isGitRepo && <span className="ml-auto text-xs text-primary">git</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="px-4 sm:px-6 pb-4 sm:pb-6 gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSelect} disabled={!data?.path}>
            Select This Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
