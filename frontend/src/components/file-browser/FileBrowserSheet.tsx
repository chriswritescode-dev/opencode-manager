import { useEffect, useState } from 'react'
import { FileBrowser } from './FileBrowser'
import { Button } from '@/components/ui/button'
import { PathDisplay } from '@/components/ui/path-display'
import { X } from 'lucide-react'

interface FileBrowserSheetProps {
  isOpen: boolean
  onClose: () => void
  basePath?: string
  repoName?: string
  initialSelectedFile?: string
}

export function FileBrowserSheet({ isOpen, onClose, basePath = '', repoName, initialSelectedFile }: FileBrowserSheetProps) {
  const normalizedBasePath = basePath || '.'
  const [isEditing, setIsEditing] = useState(false)
  const [displayPath, setDisplayPath] = useState<string>('/')
  const handleDirectoryLoad = (info: { workspaceRoot?: string; currentPath: string }) => {
    if (!info.currentPath || info.currentPath === '.' || info.currentPath === '') {
      setDisplayPath('/')
      return
    }
    
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
  }

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
      <div className="absolute inset-0 bg-background flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-border bg-background backdrop-blur-sm px-4 py-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {(displayPath === '/' || !repoName) && (
                <h1 className="text-sm font-semibold text-foreground">
                  {repoName || 'Workspace Files'}
                </h1>
              )}
              <PathDisplay path={displayPath} maxSegments={3} />
            </div>
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

        {/* File Browser Content */}
        <div className="flex-1 overflow-hidden min-h-0">
          <FileBrowser 
            basePath={normalizedBasePath}
            embedded={true}
            initialSelectedFile={initialSelectedFile}
            onDirectoryLoad={handleDirectoryLoad}
          />
        </div>
      </div>
    </div>
  )
}
