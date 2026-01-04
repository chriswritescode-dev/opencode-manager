import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { GitChangesPanel } from './GitChangesPanel'
import { FileDiffView } from './FileDiffView'
import { FilePreviewDialog } from './FilePreviewDialog'
import { FullscreenSheet, FullscreenSheetHeader, FullscreenSheetContent } from '@/components/ui/fullscreen-sheet'
import { Button } from '@/components/ui/button'
import { X, GitBranch } from 'lucide-react'
import { useMobile, useSwipeBack } from '@/hooks/useMobile'
import { useQueryClient } from '@tanstack/react-query'
import { GPU_ACCELERATED_STYLE, MODAL_TRANSITION_MS } from '@/lib/utils'

interface GitChangesSheetProps {
  isOpen: boolean
  onClose: () => void
  repoId: number
  currentBranch: string
  repoLocalPath?: string
}

export function GitChangesSheet({ isOpen, onClose, repoId, currentBranch, repoLocalPath }: GitChangesSheetProps) {
  const [selectedFile, setSelectedFile] = useState<string | undefined>()
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null)
  const [previewLineNumber, setPreviewLineNumber] = useState<number | undefined>()
  const isMobile = useMobile()
  const queryClient = useQueryClient()
  const contentRef = useRef<HTMLDivElement>(null)
  
  const { bind: bindSwipe, swipeStyles } = useSwipeBack(
    selectedFile ? () => setSelectedFile(undefined) : onClose,
    { enabled: isOpen && !previewFilePath }
  )
  
  useEffect(() => {
    return bindSwipe(contentRef.current)
  }, [bindSwipe])

  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(undefined)
      setPreviewFilePath(null)
    }
  }, [isOpen])

  const handleFileSelect = (path: string) => {
    setSelectedFile(path)
  }

  const handleBack = () => {
    setSelectedFile(undefined)
  }

  const handleOpenFile = (path: string, lineNumber?: number) => {
    setPreviewFilePath(path)
    setPreviewLineNumber(lineNumber)
  }

  const handleClosePreview = () => {
    setPreviewFilePath(null)
    setPreviewLineNumber(undefined)
  }

  const handleFileSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['gitStatus'] })
    queryClient.invalidateQueries({ queryKey: ['fileDiff'] })
  }

  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      document.body.style.overflow = 'hidden'
    } else {
      const timer = setTimeout(() => setShouldRender(false), MODAL_TRANSITION_MS)
      document.body.style.overflow = 'unset'
      return () => clearTimeout(timer)
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen && !shouldRender) return null

  return createPortal(
    <div
      ref={contentRef}
      className="fixed inset-0 z-50"
      style={{
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? 'auto' : 'none',
        transition: 'opacity 150ms ease-out',
      }}
    >
      <FullscreenSheet style={{ ...GPU_ACCELERATED_STYLE, ...swipeStyles }}>
        <FullscreenSheetHeader className="px-4 py-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                {selectedFile ? 'File Changes' : 'Git Changes'}
              </h2>
              <span className="text-xs text-muted-foreground">({currentBranch})</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 h-8 w-8"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </FullscreenSheetHeader>

        <FullscreenSheetContent>
          {isMobile ? (
            selectedFile ? (
              <FileDiffView
                repoId={repoId}
                filePath={selectedFile}
                onBack={handleBack}
                onOpenFile={handleOpenFile}
                isMobile={true}
              />
            ) : (
              <GitChangesPanel
                repoId={repoId}
                onFileSelect={handleFileSelect}
                selectedFile={selectedFile}
              />
            )
          ) : (
            <div className="flex h-full">
              <div className="w-[280px] border-r border-border overflow-hidden flex-shrink-0">
                <GitChangesPanel
                  repoId={repoId}
                  onFileSelect={handleFileSelect}
                  selectedFile={selectedFile}
                />
              </div>
              <div className="flex-1 overflow-hidden min-w-0">
                {selectedFile ? (
                  <FileDiffView
                    repoId={repoId}
                    filePath={selectedFile}
                    onOpenFile={handleOpenFile}
                    isMobile={false}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <p className="text-sm">Select a file to view changes</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </FullscreenSheetContent>

        <FilePreviewDialog
          isOpen={!!previewFilePath}
          onClose={handleClosePreview}
          filePath={previewFilePath || ''}
          repoBasePath={repoLocalPath}
          onFileSaved={handleFileSaved}
          initialLineNumber={previewLineNumber}
        />
      </FullscreenSheet>
    </div>,
    document.body
  )
}
