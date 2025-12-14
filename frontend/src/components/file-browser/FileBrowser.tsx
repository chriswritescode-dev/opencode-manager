import { useState, useEffect, useRef, useCallback } from 'react'
import { FileTree } from './FileTree'
import { FileOperations } from './FileOperations'
import { FilePreview } from './FilePreview'
import { MobileFilePreviewModal } from './MobileFilePreviewModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { FolderOpen, Upload, RefreshCw, X } from 'lucide-react'
import type { FileInfo } from '@/types/files'
import { API_BASE_URL } from '@/config'
import { useMobile } from '@/hooks/useMobile'
import { useFile } from '@/api/files'

interface UploadItem {
  file: File
  relativePath: string
}

interface UploadProgress {
  current: number
  total: number
  currentFile: string
  errors: string[]
  cancelled: boolean
}

interface FileBrowserProps {
  basePath?: string
  onFileSelect?: (file: FileInfo) => void
  embedded?: boolean
  initialSelectedFile?: string
  onDirectoryLoad?: (info: { workspaceRoot?: string; currentPath: string }) => void
}

async function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

async function readDirectoryEntries(dirReader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    dirReader.readEntries(resolve, reject)
  })
}

async function traverseFileSystemEntry(
  entry: FileSystemEntry,
  basePath: string = ''
): Promise<UploadItem[]> {
  const items: UploadItem[] = []
  const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    const file = await readFileEntry(fileEntry)
    items.push({ file, relativePath })
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const dirReader = dirEntry.createReader()
    let entries: FileSystemEntry[] = []
    let batch: FileSystemEntry[]
    
    do {
      batch = await readDirectoryEntries(dirReader)
      entries = entries.concat(batch)
    } while (batch.length > 0)

    for (const childEntry of entries) {
      const childItems = await traverseFileSystemEntry(childEntry, relativePath)
      items.push(...childItems)
    }
  }

  return items
}

async function getUploadItemsFromDataTransfer(dataTransfer: DataTransfer): Promise<UploadItem[]> {
  const items: UploadItem[] = []
  const entries: FileSystemEntry[] = []

  for (let i = 0; i < dataTransfer.items.length; i++) {
    const item = dataTransfer.items[i]
    const entry = item.webkitGetAsEntry?.()
    if (entry) {
      entries.push(entry)
    }
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      const entryItems = await traverseFileSystemEntry(entry)
      items.push(...entryItems)
    }
  } else {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i]
      items.push({ file, relativePath: file.name })
    }
  }

  return items
}

function getUploadItemsFromFileList(fileList: FileList): UploadItem[] {
  const items: UploadItem[] = []
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i]
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    items.push({ file, relativePath })
  }
  return items
}

export function FileBrowser({ basePath = '', onFileSelect, embedded = false, initialSelectedFile, onDirectoryLoad }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(basePath)
  const [files, setFiles] = useState<FileInfo | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const uploadCancelledRef = useRef(false)
  const isMobile = useMobile()

   const { data: initialFileData, error: initialFileError } = useFile(initialSelectedFile)

useEffect(() => {
  if (initialFileData) {
    setSelectedFile(initialFileData)
    if (isMobile) {
      setIsPreviewModalOpen(true)
    }
  }
}, [initialFileData, isMobile])

useEffect(() => {
  if (initialFileError) {
    setError(initialFileError.message)
  }
}, [initialFileError])

  const loadFiles = async (path: string) => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/files/${path}`)
      if (!response.ok) {
        throw new Error(`Failed to load files: ${response.statusText}`)
      }
      
      const data = await response.json()
      setFiles(data)
      setCurrentPath(path)
      onDirectoryLoad?.({ workspaceRoot: data.workspaceRoot, currentPath: path })
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
      const response = await fetch(`${API_BASE_URL}/api/files/${file.path}`)
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

  const handleCloseModal = useCallback(() => {
    setIsPreviewModalOpen(false)
    setSelectedFile(null)
  }, [])

  const handleDirectoryClick = (path: string) => {
    loadFiles(path)
  }

  const handleRefresh = () => {
    loadFiles(currentPath)
  }

  const uploadSingleFile = useCallback(async (item: UploadItem): Promise<string | null> => {
    const formData = new FormData()
    formData.append('file', item.file)
    formData.append('relativePath', item.relativePath)
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/files/${currentPath}`, {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return errorData.error || `Upload failed: ${response.statusText}`
      }
      
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Upload failed'
    }
  }, [currentPath])

  const handleUploadItems = useCallback(async (items: UploadItem[]) => {
    if (items.length === 0) return

    uploadCancelledRef.current = false
    const errors: string[] = []
    
    setUploadProgress({
      current: 0,
      total: items.length,
      currentFile: items[0].relativePath,
      errors: [],
      cancelled: false,
    })

    for (let i = 0; i < items.length; i++) {
      if (uploadCancelledRef.current) {
        setUploadProgress(prev => prev ? { ...prev, cancelled: true } : null)
        break
      }

      const item = items[i]
      setUploadProgress(prev => prev ? {
        ...prev,
        current: i,
        currentFile: item.relativePath,
      } : null)

      const error = await uploadSingleFile(item)
      if (error) {
        errors.push(`${item.relativePath}: ${error}`)
      }
    }

    setUploadProgress(prev => prev ? {
      ...prev,
      current: items.length,
      errors,
      cancelled: uploadCancelledRef.current,
    } : null)

    await loadFiles(currentPath)
  }, [currentPath, uploadSingleFile])

  const handleUpload = useCallback(async (fileList: FileList) => {
    const items = getUploadItemsFromFileList(fileList)
    await handleUploadItems(items)
  }, [handleUploadItems])

  const cancelUpload = useCallback(() => {
    uploadCancelledRef.current = true
  }, [])

  const handleCreateFile = useCallback(async (name: string, type: 'file' | 'folder') => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/files/${currentPath}/${name}`, {
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
  }, [currentPath])

  const handleDelete = useCallback(async (path: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/files/${path}`, {
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
  }, [currentPath])

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/files/${oldPath}`, {
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
  }, [currentPath])

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

    const items = await getUploadItemsFromDataTransfer(e.dataTransfer)
    if (items.length > 0) {
      await handleUploadItems(items)
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

  const isUploadComplete = uploadProgress && uploadProgress.current >= uploadProgress.total
  const canDismissDialog = isUploadComplete || uploadProgress?.cancelled

  const uploadDialog = (
    <Dialog open={!!uploadProgress} onOpenChange={(open) => { if (!open && canDismissDialog) setUploadProgress(null) }}>
      <DialogContent className="sm:max-w-md" hideCloseButton={!canDismissDialog}>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>
              {uploadProgress?.cancelled ? 'Upload Cancelled' : 
               isUploadComplete ? 'Upload Complete' : 'Uploading...'}
            </span>
            {uploadProgress && uploadProgress.current < uploadProgress.total && !uploadProgress.cancelled && (
              <Button variant="ghost" size="sm" onClick={cancelUpload}>
                <X className="w-4 h-4" />
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>
        {uploadProgress && (
          <div className="space-y-3">
            <Progress 
              value={uploadProgress.current} 
              max={uploadProgress.total} 
            />
            <p className="text-sm text-muted-foreground">
              {uploadProgress.current} / {uploadProgress.total} files
            </p>
            {!isUploadComplete && (
              <p className="text-xs text-muted-foreground truncate">
                {uploadProgress.currentFile}
              </p>
            )}
            {uploadProgress.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">
                  {uploadProgress.errors.length} file(s) failed:
                </p>
                <div className="max-h-32 overflow-y-auto rounded border border-destructive/20 bg-destructive/5 p-2">
                  {uploadProgress.errors.map((error, index) => (
                    <p key={index} className="text-xs text-destructive break-all">
                      {error}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {canDismissDialog && (
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full mt-2"
                onClick={() => setUploadProgress(null)}
              >
                Close
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
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
              <p className="text-lg font-semibold text-primary">Drop files or folders here to upload</p>
            </div>
          </div>
        )}
        
        {uploadDialog}
        
        {/* Mobile: Full width file listing, Desktop: Split view */}
        <div className="flex-1 flex overflow-hidden min-h-0 h-full">
          <div className={`${isMobile ? 'w-full' : 'w-[30%]'} border-r border-border px-1 md:px-4 flex flex-col min-h-0 h-full`}>
            <div className="flex items-center gap-2 mb-4 mt-4 flex-shrink-0">
              <Input
                placeholder="Search"
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
            
            <div className="flex-1 overflow-y-auto min-h-0">
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
            <div className="flex-1 overflow-y-auto min-h-0 h-full">
              {selectedFile && !selectedFile.isDirectory ? (
                <FilePreview file={selectedFile} />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Select a file to preview
                </div>
              )}
            </div>
          )}
        </div>

{/* Mobile: File Preview Modal */}
        <MobileFilePreviewModal 
          isOpen={isMobile && isPreviewModalOpen}
          onClose={handleCloseModal}
          file={selectedFile}
          showFilePreviewHeader={true}
        />
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
          <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center">
            <div className="text-center">
              <Upload className="w-12 h-12 mx-auto mb-2 text-primary" />
              <p className="text-lg font-semibold text-primary">Drop files or folders here to upload</p>
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
          
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {error}
            </div>
          )}
        </CardHeader>
        
        <CardContent className="flex-1 flex overflow-hidden min-h-0">
          {/* Mobile: Full width file listing, Desktop: Split view */}
          <div className={`${isMobile ? 'w-full' : 'w-1/3'} border-r pr-4 flex flex-col min-h-0`}>
            <div className="flex items-center gap-2 mb-4 flex-shrink-0">
              <Input
                placeholder="Search"
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
              <div className="flex-1 overflow-y-auto min-h-0">
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
            <div className="flex-1 overflow-y-auto min-h-0 ">
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
      <MobileFilePreviewModal 
        isOpen={isMobile && isPreviewModalOpen}
        onClose={handleCloseModal}
        file={selectedFile}
      />
      
      {uploadDialog}
    </div>
  )
}
