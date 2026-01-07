import { useState, useEffect } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { FilePreview } from './FilePreview'
import { Loader2, FileText } from 'lucide-react'
import { API_BASE_URL } from '@/config'
import type { FileInfo } from '@/types/files'

interface FilePreviewDialogProps {
  isOpen: boolean
  onClose: () => void
  filePath: string
  repoBasePath?: string
  onFileSaved?: () => void
  initialLineNumber?: number
}

export function FilePreviewDialog({ isOpen, onClose, filePath, repoBasePath, onFileSaved, initialLineNumber }: FilePreviewDialogProps) {
  const [file, setFile] = useState<FileInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !filePath) {
      setFile(null)
      setError(null)
      return
    }

    const fetchFile = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const fullPath = repoBasePath ? `${repoBasePath}/${filePath}` : filePath
        const response = await fetch(`${API_BASE_URL}/api/files/${fullPath}`)
        
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.statusText}`)
        }

        const data = await response.json()
        setFile(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file')
      } finally {
        setIsLoading(false)
      }
    }

    fetchFile()
  }, [isOpen, filePath, repoBasePath])

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-screen h-screen max-w-none max-h-none p-0 bg-background border-0 flex flex-col"
        hideCloseButton
      >
        <div className="flex-1 overflow-hidden min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileText className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">Failed to load file</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          ) : file ? (
            <FilePreview 
              file={file} 
              hideHeader={false}
              isMobileModal={true}
              onCloseModal={onClose}
              onFileSaved={onFileSaved}
              initialLineNumber={initialLineNumber}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
