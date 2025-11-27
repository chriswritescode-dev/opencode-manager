import { useState, useEffect } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { GitChangesPanel } from './GitChangesPanel'
import { FileDiffView } from './FileDiffView'
import { FilePreviewDialog } from './FilePreviewDialog'
import { Button } from '@/components/ui/button'
import { X, GitBranch } from 'lucide-react'
import { useMobile } from '@/hooks/useMobile'
import { useQueryClient } from '@tanstack/react-query'

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

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-screen h-screen max-w-none max-h-none p-0 gap-0 bg-background border-0 flex flex-col"
        hideCloseButton
      >
        <div className="flex items-center justify-between px-4 sm:py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-400" />
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

        <div className="flex-1 overflow-hidden min-h-0">
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
        </div>

        <FilePreviewDialog
          isOpen={!!previewFilePath}
          onClose={handleClosePreview}
          filePath={previewFilePath || ''}
          repoBasePath={repoLocalPath}
          onFileSaved={handleFileSaved}
          initialLineNumber={previewLineNumber}
        />
      </DialogContent>
    </Dialog>
  )
}
