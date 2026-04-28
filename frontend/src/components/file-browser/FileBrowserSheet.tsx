import { useEffect, useState, memo, useCallback, useRef } from 'react'
import { FileBrowser, type FileBrowserHandle } from './FileBrowser'
import { Button } from '@/components/ui/button'
import { PathDisplay } from '@/components/ui/path-display'
import { FullscreenSheet, FullscreenSheetHeader, FullscreenSheetContent } from '@/components/ui/fullscreen-sheet'
import { DownloadDialog } from '@/components/ui/download-dialog'
import { X, Download } from 'lucide-react'
import { GPU_ACCELERATED_STYLE, MODAL_TRANSITION_MS } from '@/lib/utils'
import { useSwipeBack } from '@/hooks/useMobile'
import { downloadDirectoryAsZip } from '@/api/files'
import { downloadRepo } from '@/api/repos'
import type { FileInfo } from '@/types/files'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface FileBrowserSheetProps {
  isOpen: boolean
  onClose: () => void
  basePath?: string
  repoName?: string
  repoId?: number
  initialSelectedFile?: string
  allowNavigateAboveBase?: boolean
  onFileSelect?: (file: FileInfo) => void
}

export const FileBrowserSheet = memo(function FileBrowserSheet({ isOpen, onClose, basePath = '', repoName, repoId, initialSelectedFile, allowNavigateAboveBase = false, onFileSelect }: FileBrowserSheetProps) {
  const normalizedBasePath = basePath || '.'
  const [isEditing, setIsEditing] = useState(false)
  const [displayPath, setDisplayPath] = useState<string>('/')
  const [shouldRender, setShouldRender] = useState(false)
  const [currentPath, setCurrentPath] = useState<string>(basePath || '.')
  const [downloadDialog, setDownloadDialog] = useState<{ type: 'directory' | 'repository' } | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileBrowserRef = useRef<FileBrowserHandle>(null)

  const { bind, swipeStyles } = useSwipeBack(onClose, {
    enabled: isOpen && !isEditing && !isPreviewOpen,
    canBack: () => fileBrowserRef.current?.canGoBack() ?? false,
    onBack: () => fileBrowserRef.current?.goBack(),
  })

  useEffect(() => {
    return bind(containerRef.current)
  }, [bind])

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      setIsPreviewOpen(false)
      const timer = setTimeout(() => setShouldRender(false), MODAL_TRANSITION_MS)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleDirectoryLoad = useCallback((info: { workspaceRoot?: string; currentPath: string }) => {
    if (allowNavigateAboveBase) {
      const pathParts = info.currentPath.split('/').filter(Boolean)
      const displayParts = pathParts[0] === '..'
        ? ['workspace', ...pathParts.slice(1)]
        : ['workspace', 'repos', ...pathParts]

      setDisplayPath('/' + displayParts.join('/'))
      setCurrentPath(info.currentPath || '.')
      return
    }

    if (!info.currentPath || info.currentPath === '.' || info.currentPath === '') {
      setDisplayPath('/')
      setCurrentPath(info.currentPath || '.')
      return
    }

    setCurrentPath(info.currentPath)

    const pathParts = info.currentPath.split('/').filter(Boolean)

    if (repoName) {
      const repoIndex = pathParts.findIndex(p => p === repoName || p.startsWith(repoName + '-'))
      if (repoIndex >= 0) {
        const subPath = pathParts.slice(repoIndex + 1)
        setDisplayPath(subPath.length > 0 ? '/' + subPath.join('/') : '/')
      } else {
        setDisplayPath('/' + pathParts.join('/'))
      }
    } else {
      setDisplayPath('/' + pathParts.join('/'))
    }
  }, [allowNavigateAboveBase, repoName])

  const handleDownloadDirectory = useCallback(async (options: { includeGit?: boolean, includePaths?: string[] }) => {
    if (!currentPath) return
    await downloadDirectoryAsZip(currentPath, options)
  }, [currentPath])

  const handleDownloadRepo = useCallback(async (options: { includeGit?: boolean, includePaths?: string[] }) => {
    if (!repoId || !repoName) return
    await downloadRepo(repoId, repoName, options)
  }, [repoId, repoName])

  const handleOpenDownloadDialog = (type: 'directory' | 'repository') => {
    setDownloadDialog({ type })
  }

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isPreviewOpen) {
        onClose()
      }
    }

    const handleEditModeChange = (event: CustomEvent<{ isEditing: boolean }>) => {
      setIsEditing(event.detail.isEditing)
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.addEventListener('editModeChange', handleEditModeChange as EventListener)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.removeEventListener('editModeChange', handleEditModeChange as EventListener)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose, isPreviewOpen])

  if (!isOpen && !shouldRender) return null

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50"
      style={{
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        transition: 'opacity 150ms ease-out',
      }}
    >
      <FullscreenSheet style={{ ...GPU_ACCELERATED_STYLE, ...swipeStyles }}>
        <FullscreenSheetHeader className="px-4 py-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
              {(displayPath === '/' || !repoName) && repoName && (
                <h1 className="text-sm font-semibold text-foreground shrink-0 truncate max-w-[150px]">
                  {repoName}
                </h1>
              )}
              <PathDisplay path={displayPath} maxSegments={4} className="truncate" />
            </div>
            <div className="flex items-center gap-2">
              {repoId && !isEditing && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200"
                    >
                      <Download className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleOpenDownloadDialog('directory')}>
                      <Download className="w-4 h-4 mr-2" />
                      Current Directory
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleOpenDownloadDialog('repository')}>
                      <Download className="w-4 h-4 mr-2" />
                      Entire Repository
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {!isEditing && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200"
                >
                  <X className="w-5 h-5" />
                </Button>
              )}
            </div>
          </div>
        </FullscreenSheetHeader>

        <FullscreenSheetContent>
          <FileBrowser
            ref={fileBrowserRef}
            basePath={normalizedBasePath}
            embedded={true}
            initialSelectedFile={initialSelectedFile}
            onFileSelect={onFileSelect}
            onDirectoryLoad={handleDirectoryLoad}
            onPreviewStateChange={setIsPreviewOpen}
            allowNavigateAboveBase={allowNavigateAboveBase}
          />
        </FullscreenSheetContent>
      </FullscreenSheet>

      <DownloadDialog
        open={downloadDialog !== null}
        onOpenChange={(open) => !open && setDownloadDialog(null)}
        onDownload={downloadDialog?.type === 'directory' ? handleDownloadDirectory : handleDownloadRepo}
        title={downloadDialog?.type === 'directory' ? 'Download Current Directory' : 'Download Repository'}
        description={downloadDialog?.type === 'directory'
          ? 'This will create a ZIP archive of the current directory and all its contents.'
          : 'This will create a ZIP archive of the entire repository.'}
        itemName={downloadDialog?.type === 'directory' ? currentPath.split('/').pop() || 'Directory' : repoName || 'Repository'}
        targetPath={downloadDialog?.type === 'directory' ? currentPath : basePath}
      />
    </div>
  )
})
