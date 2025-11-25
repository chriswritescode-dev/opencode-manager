import { useEffect, useState } from 'react'
import { FileBrowser } from './FileBrowser'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

interface FileBrowserSheetProps {
  isOpen: boolean
  onClose: () => void
  basePath?: string
  repoName?: string
  initialSelectedFile?: string
}

export function FileBrowserSheet({ isOpen, onClose, basePath = '', repoName, initialSelectedFile }: FileBrowserSheetProps) {
  const [isEditing, setIsEditing] = useState(false)

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
      <div className="absolute inset-0 bg-background">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-background backdrop-blur-sm px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-foreground">
                {repoName ? `${repoName} - Files` : 'Workspace Files'}
              </h1>
              {basePath && (
                <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded">
                  {basePath}
                </span>
              )}
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
        <div className="h-[calc(100vh-73px)] overflow-hidden">
          <FileBrowser 
            basePath={basePath}
            embedded={true}
            initialSelectedFile={initialSelectedFile}
          />
        </div>
      </div>
    </div>
  )
}