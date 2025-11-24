import { useState, useEffect, useRef, useCallback } from 'react'
import { FileTree } from './FileTree'
import { FileOperations } from './FileOperations'
import { FilePreview } from './FilePreview'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FolderOpen, Upload, RefreshCw, X } from 'lucide-react'
import type { FileInfo } from '@/types/files'
import { API_BASE_URL } from '@/constants/api'

const API_BASE = API_BASE_URL

// Hook to detect mobile screens
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }

    checkIsMobile()
    window.addEventListener('resize', checkIsMobile)

    return () => window.removeEventListener('resize', checkIsMobile)
  }, [])

  return isMobile
}

interface FileBrowserProps {
  basePath?: string
  onFileSelect?: (file: FileInfo) => void
  embedded?: boolean
  initialSelectedFile?: string
}

export function FileBrowser({ basePath = '', onFileSelect, embedded = false, initialSelectedFile }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(basePath)
  const [files, setFiles] = useState<FileInfo | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
  
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()

   useEffect(() => {
     if (initialSelectedFile) {
       const loadInitialFile = async () => {
         try {
           const url = `${API_BASE}/api/files/${initialSelectedFile}`
           
           const response = await fetch(url)
           
           if (response.ok) {
             const fileData = await response.json()
            setSelectedFile(fileData)
            if (isMobile) {
              setIsPreviewModalOpen(true)
            }
          } else {
            const errorText = await response.text()
            console.error('[FileBrowser] Failed to load file:', errorText)
            setError(`Failed to load file: ${errorText}`)
          }
        } catch (err) {
          console.error('[FileBrowser] Failed to load initial file:', err)
          setError(err instanceof Error ? err.message : 'Failed to load file')
        }
      }
      loadInitialFile()
    }
  }, [initialSelectedFile, isMobile, basePath])

  const loadFiles = async (path: string) => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`${API_BASE}/api/files/${path}`)
      if (!response.ok) {
        throw new Error(`Failed to load files: ${response.statusText}`)
      }
      
      const data = await response.json()
      setFiles(data)
      setCurrentPath(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = useCallback(async (file: FileInfo) => {
    if (file.isDirectory) {
      setSelectedFile(null)
      return
    }
    
    // Fetch the full file content when selecting a file
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/files/${file.path}`)
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`)
      }
      
      const fullFileData = await response.json()
      setSelectedFile(fullFileData)
      onFileSelect?.(fullFileData)
      
      // On mobile, open preview in modal
      if (isMobile) {
        setIsPreviewModalOpen(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
      setSelectedFile(null)
    } finally {
      setLoading(false)
    }
  }, [onFileSelect, isMobile])

  const handleCloseModal = () => {
    setIsPreviewModalOpen(false)
    setSelectedFile(null)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault()
  }

  const handleDirectoryClick = (path: string) => {
    loadFiles(path)
  }

  const handleRefresh = () => {
    loadFiles(currentPath)
  }

  const handleUpload = async (files: FileList) => {
    const formData = new FormData()
    formData.append('file', files[0])
    
    try {
      const response = await fetch(`${API_BASE}/api/files/${currentPath}`, {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`)
      }
      
      await loadFiles(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const handleCreateFile = async (name: string, type: 'file' | 'folder') => {
    try {
      const response = await fetch(`${API_BASE}/api/files/${currentPath}/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content: type === 'file' ? '' : undefined }),
      })
      
      if (!response.ok) {
        throw new Error(`Create failed: ${response.statusText}`)
      }
      
      await loadFiles(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    }
  }

  const handleDelete = async (path: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/files/${path}`, {
        method: 'DELETE',
      })
      
      if (!response.ok) {
        throw new Error(`Delete failed: ${response.statusText}`)
      }
      
      await loadFiles(currentPath)
      setSelectedFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const handleRename = async (oldPath: string, newPath: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/files/${oldPath}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPath }),
      })
      
      if (!response.ok) {
        throw new Error(`Rename failed: ${response.statusText}`)
      }
      
      await loadFiles(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === dropZoneRef.current) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const droppedFiles = e.dataTransfer.files
    if (droppedFiles.length > 0) {
      await handleUpload(droppedFiles)
    }
  }

  useEffect(() => {
    loadFiles(basePath)
  }, [basePath])

  useEffect(() => {
    const handleFileSaved = (event: CustomEvent<{ path: string; content: string }>) => {
      if (selectedFile && selectedFile.path === event.detail.path) {
        handleFileSelect(selectedFile)
      }
    }

    window.addEventListener('fileSaved', handleFileSaved as EventListener)
    return () => window.removeEventListener('fileSaved', handleFileSaved as EventListener)
  }, [selectedFile, handleFileSelect])

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPreviewModalOpen) {
        handleCloseModal()
      }
    }

    if (isPreviewModalOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isPreviewModalOpen])

  const filteredFiles = files?.children?.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (embedded) {
    return (
      <div 
        className="h-full flex flex-col bg-background"
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center">
            <div className="text-center">
              <Upload className="w-12 h-12 mx-auto mb-2 text-primary" />
              <p className="text-lg font-semibold text-primary">Drop files here to upload</p>
            </div>
          </div>
        )}
        
        {/* Mobile: Full width file listing, Desktop: Split view */}
        <div className="flex-1 flex overflow-hidden">
          <div className={`${isMobile ? 'w-full' : 'w-1/2'} border-r border-border px-4 flex flex-col`}>
            <div className="flex items-center gap-2 mb-4 mt-4 flex-shrink-0">
              <Input
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <FileOperations
                onUpload={handleUpload}
                onCreate={handleCreateFile}
                
              />
            </div>
            
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-2 rounded mb-4 flex-shrink-0">
                {error}
              </div>
            )}
            
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <FileTree
                  files={filteredFiles || []}
                  onFileSelect={handleFileSelect}
                  onDirectoryClick={handleDirectoryClick}
                  selectedFile={selectedFile}
                  onDelete={handleDelete}
                  onRename={handleRename}
                  currentPath={currentPath}
                  basePath={basePath}
                />
              )}
            </div>
          </div>
          
          {/* Desktop only: Preview panel */}
          {!isMobile && (
            <div className="flex-1 pl-4 overflow-y-auto">
              {selectedFile && !selectedFile.isDirectory ? (
                <FilePreview file={selectedFile} />
              ) : (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                  Select a file to preview
                </div>
              )}
            </div>
          )}
        </div>

{/* Mobile: File Preview Modal */}
        {isMobile && selectedFile && !selectedFile.isDirectory && (
          <Dialog open={isPreviewModalOpen} onOpenChange={(open) => !open && handleCloseModal()}>
            <DialogContent 
              className="w-screen h-screen max-w-none max-h-none p-0 bg-background border-0 flex flex-col [&>button:last-child]:hidden"
            >
              <div className="flex-1 overflow-hidden min-h-0">
                <FilePreview file={selectedFile} hideHeader={false} isMobileModal={true} onCloseModal={handleCloseModal} />
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    )
  }

  return (
    <div 
      className="h-full flex flex-col"
      ref={dropZoneRef}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Card className="flex-1 relative">
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-blue-50/90 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <Upload className="w-12 h-12 mx-auto mb-2 text-blue-500" />
              <p className="text-lg font-semibold text-blue-600">Drop files here to upload</p>
            </div>
          </div>
        )}
        
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5" />
              File Browser
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <FileOperations
onUpload={handleUpload}
                onCreate={handleCreateFile}
            />
          </div>
          
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {error}
            </div>
          )}
        </CardHeader>
        
        <CardContent className="flex-1 flex overflow-hidden">
          {/* Mobile: Full width file listing, Desktop: Split view */}
          <div className={`${isMobile ? 'w-full' : 'w-1/3'} border-r pr-4 flex flex-col`}>
            <div className="flex items-center gap-2 mb-4 flex-shrink-0">
              <Input
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <FileOperations
                onUpload={handleUpload}
                onCreate={handleCreateFile}
                
              />
            </div>
            
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <FileTree
                  files={filteredFiles || []}
                  onFileSelect={handleFileSelect}
                  onDirectoryClick={handleDirectoryClick}
                  selectedFile={selectedFile}
                  onDelete={handleDelete}
                  onRename={handleRename}
                  currentPath={currentPath}
                  basePath={basePath}
                />
              </div>
            )}
          </div>
          
          {/* Desktop only: Preview panel */}
          {!isMobile && (
            <div className="flex-1 pl-4 overflow-y-auto">
              {selectedFile && !selectedFile.isDirectory ? (
                <FilePreview file={selectedFile} />
              ) : (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                  Select a file to preview
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

{/* Mobile: File Preview Modal */}
      {isMobile && selectedFile && !selectedFile.isDirectory && (
        <Dialog open={isPreviewModalOpen} onOpenChange={(open) => !open && handleCloseModal()}>
          <DialogContent 
            className="w-screen h-screen max-w-none max-h-none p-0 bg-background border-0 flex flex-col"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <DialogHeader className="p-4 border-b border-border flex-shrink-0 relative bg-background z-10">
              <div className="flex justify-center mb-2">
                <div className="w-8 h-1 bg-muted rounded-full"></div>
              </div>
              <DialogTitle className="text-foreground text-lg pr-12">
                {selectedFile.name}
              </DialogTitle>
              <button
                onClick={handleCloseModal}
                className="absolute right-4 top-4 p-2 rounded-md hover:bg-muted text-foreground transition-colors touch-manipulation bg-muted border border-border"
                aria-label="Close modal"
              >
                <X className="w-6 h-6" />
              </button>
            </DialogHeader>
            <div className="flex-1 overflow-hidden min-h-0">
              <FilePreview file={selectedFile} hideHeader={true} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}