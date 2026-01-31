import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Download, Loader2, Archive, Folder } from 'lucide-react'
import { getIgnoredPaths } from '@/api/files'

interface DownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: (options: { includeGit?: boolean, includePaths?: string[] }) => Promise<void>
  title: string
  description: string
  itemName: string
  targetPath?: string
}

export function DownloadDialog({
  open,
  onOpenChange,
  onDownload,
  title,
  description,
  itemName,
  targetPath,
}: DownloadDialogProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [isLoadingIgnored, setIsLoadingIgnored] = useState(false)
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([])
  const [ignoredPathsError, setIgnoredPathsError] = useState<string | null>(null)
  const [includeAll, setIncludeAll] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open && targetPath) {
      setIsLoadingIgnored(true)
      setIgnoredPathsError(null)
      getIgnoredPaths(targetPath)
        .then(response => {
          setIgnoredPaths(response.ignoredPaths)
          setIsLoadingIgnored(false)
        })
        .catch((error) => {
          setIgnoredPathsError(error.message || 'Failed to load ignored paths')
          setIsLoadingIgnored(false)
        })
    }
  }, [open, targetPath])

  useEffect(() => {
    if (includeAll) {
      setSelectedPaths(new Set(ignoredPaths))
    }
  }, [includeAll, ignoredPaths])

  useEffect(() => {
    if (selectedPaths.size === ignoredPaths.length && !includeAll) {
      setIncludeAll(true)
    } else if (selectedPaths.size < ignoredPaths.length && includeAll) {
      setIncludeAll(false)
    }
  }, [selectedPaths.size, ignoredPaths.length, includeAll])

  const handleCheckboxChange = (path: string, checked: boolean) => {
    const newSelected = new Set(selectedPaths)
    if (checked) {
      newSelected.add(path)
    } else {
      newSelected.delete(path)
    }
    setSelectedPaths(newSelected)
    setIncludeAll(newSelected.size === ignoredPaths.length)
  }

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsConfirmed(true)
    setIsDownloading(true)
    try {
      const includeGit = selectedPaths.has('.git/')
      const includePaths = Array.from(selectedPaths).filter(p => p !== '.git/')
      await onDownload({ includeGit, includePaths })
    } catch (error) {
      console.error('Download failed:', error)
    } finally {
      setIsDownloading(false)
      onOpenChange(false)
      setIsConfirmed(false)
    }
  }

  const handleCancel = (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    if (isDownloading) return
    onOpenChange(false)
    setIsConfirmed(false)
  }
  
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      handleCancel()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDownloading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Archive className="w-5 h-5" />
            )}
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {!isDownloading && (
            <DialogDescription>
              {description}
            </DialogDescription>
          )}
          
          {!isDownloading && !isLoadingIgnored && ignoredPaths.length > 0 && (
              <div className="space-y-3">
              <div
                className="flex items-center space-x-2 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  setIncludeAll(!includeAll)
                }}
              >
                <Checkbox
                  id="download-all"
                  checked={includeAll}
                  onCheckedChange={() => {}}
                />
                <span className="text-sm font-medium">
                  Download All
                </span>
              </div>

              <div className="space-y-2 pl-6">
                {ignoredPaths.map(path => (
                  <div
                    key={path}
                    className="flex items-center space-x-2 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCheckboxChange(path, !selectedPaths.has(path))
                    }}
                  >
                    <Checkbox
                      id={`path-${path}`}
                      checked={selectedPaths.has(path)}
                      onCheckedChange={() => {}}
                    />
                    <span className="text-sm text-muted-foreground flex items-center gap-2">
                      <Folder className="w-4 h-4" />
                      {path}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isDownloading && isLoadingIgnored && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isDownloading && ignoredPathsError && (
            <div className="p-3 bg-destructive/10 rounded-md">
              <p className="text-sm text-destructive">{ignoredPathsError}</p>
            </div>
          )}
          
          <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
            <Archive className="w-8 h-8 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{isConfirmed ? 'Processing...' : itemName}</p>
              {isDownloading && (
                <p className="text-xs text-muted-foreground mt-1">
                  Creating ZIP archive, please wait...
                </p>
              )}
            </div>
          </div>

          {isDownloading && (
            <div className="space-y-2">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary animate-progress w-full" />
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Download starting...
              </p>
            </div>
          )}
        </div>
        <DialogFooter >
          {!isDownloading && !isConfirmed && (
            <div className='flex gap-2 w-full'>
              <Button type="button" variant="outline" onClick={handleCancel} className="flex-1">
                Cancel
              </Button>
              <Button type="button" onClick={handleConfirm} className="gap-2 flex-1">
                <Download className="w-4 h-4" />
                Download
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
