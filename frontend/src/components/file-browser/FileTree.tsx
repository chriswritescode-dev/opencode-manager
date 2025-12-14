import { useState, memo } from 'react'
import { useMobile } from '@/hooks/useMobile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { API_BASE_URL } from '@/config'
import { 
  File, 
  Folder, 
  FolderOpen, 
  ChevronRight, 
  ChevronDown,
  MoreHorizontal,
  Trash2,
  Edit3,
  Download
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { FileInfo } from '@/types/files'

interface FileTreeProps {
  files: FileInfo[]
  onFileSelect: (file: FileInfo) => void
  onDirectoryClick: (path: string) => void
  selectedFile: FileInfo | null
  onDelete: (path: string) => void
  onRename: (oldPath: string, newPath: string) => void
  currentPath?: string
  basePath?: string
}

interface TreeNodeProps {
  file: FileInfo
  level: number
  onFileSelect: (file: FileInfo) => void
  onDirectoryClick: (path: string) => void
  selectedFile?: FileInfo | null
  onDelete?: (path: string) => void
  onRename?: (oldPath: string, newPath: string) => void
}

function TreeNode({ file, level, onFileSelect, onDirectoryClick, selectedFile, onDelete, onRename }: TreeNodeProps) {
  const isMobile = useMobile()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(file.name)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const handleClick = () => {
    if (file.isDirectory) {
      onDirectoryClick(file.path)
    } else {
      onFileSelect(file)
    }
  }

  const handleDelete = () => {
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = () => {
    onDelete?.(file.path)
    setDeleteDialogOpen(false)
  }

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false)
  }

  const handleRename = () => {
    setEditing(true)
    setEditName(file.name)
  }

  const handleRenameSubmit = () => {
    if (editName && editName !== file.name) {
      const newPath = file.path.replace(/\/[^/]+$/, `/${editName}`)
      onRename?.(file.path, newPath)
    }
    setEditing(false)
  }

  const handleRenameCancel = () => {
    setEditing(false)
    setEditName(file.name)
  }

  const handleDownload = () => {
    if (file.isDirectory) return
    
    const downloadUrl = `${API_BASE_URL}/api/files/${file.path}?download=true`
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const getFileIcon = () => {
    if (file.isDirectory) {
      return expanded ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />
    }
    
    const ext = file.name.split('.').pop()?.toLowerCase()
    const iconMap: Record<string, string> = {
      'js': '🟨',
      'ts': '🔷',
      'jsx': '🟨',
      'tsx': '🔷',
      'json': '📋',
      'md': '📝',
      'html': '🌐',
      'css': '🎨',
      'png': '🖼️',
      'jpg': '🖼️',
      'jpeg': '🖼️',
      'gif': '🖼️',
      'svg': '🖼️',
      'pdf': '📄',
      'zip': '📦',
    }
    
    return (
      <span className="w-4 h-4 flex items-center justify-center text-xs">
        {iconMap[ext || ''] || <File className="w-4 h-4" />}
      </span>
    )
  }

  return (
    <div>
      <div 
        className={`flex items-center gap-1 px-2 py-1 hover:bg-muted rounded cursor-pointer group ${
          selectedFile?.path === file.path ? 'bg-muted' : ''
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {file.isDirectory && (
          <Button
            variant="ghost"
            size="sm"
            className="w-4 h-4 p-0"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
              if (!expanded) {
                onDirectoryClick(file.path)
              }
            }}
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </Button>
        )}
        
        <div className="flex items-center gap-1 flex-1" onClick={handleClick}>
          {getFileIcon()}
          
          {editing ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit()
                if (e.key === 'Escape') handleRenameCancel()
              }}
              className="h-6 text-sm"
              autoFocus
            />
          ) : (
            <span className="text-sm truncate">{file.name}</span>
          )}
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`w-6 h-6 p-0 ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              <MoreHorizontal className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {!file.isDirectory && (
              <DropdownMenuItem onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                Download
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleRename}>
              <Edit3 className="w-4 h-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} className="text-red-600">
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {file.isDirectory && expanded && file.children && (
        <div>
          {file.children.map((child) => (
            <TreeNode
              key={child.path}
              file={child}
              level={level + 1}
              onFileSelect={onFileSelect}
              onDirectoryClick={onDirectoryClick}
              selectedFile={selectedFile}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}
        </div>
      )}

      <DeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        title={`Delete ${file.isDirectory ? 'Folder' : 'File'}`}
        description={`Are you sure you want to delete this ${file.isDirectory ? 'folder' : 'file'}?`}
        itemName={file.name}
      />
    </div>
  )
}

export const FileTree = memo(function FileTree({ files, onFileSelect, onDirectoryClick, selectedFile, onDelete, onRename, currentPath = '', basePath = '' }: FileTreeProps) {
  const handleGoUp = () => {
    // If currentPath has content and is different from basePath, go up
    if (currentPath !== basePath) {
      const pathParts = currentPath.split('/').filter(p => p)
      pathParts.pop()
      const parentPath = pathParts.join('/')
      onDirectoryClick(parentPath)
    }
  }

  // Show ".." if we're not at the base path (empty string means root)
  const showGoUp = currentPath && currentPath !== basePath

  return (
    <div className="overflow-y-auto">
      {showGoUp && (
        <div 
          className="flex items-center gap-1 px-2 py-1 hover:bg-muted rounded cursor-pointer"
          onClick={handleGoUp}
        >
          <span className="w-4 h-4 flex items-center justify-center text-sm">↩️</span>
          <span className="text-sm text-muted-foreground">..</span>
        </div>
      )}
      
      {files.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No files in this directory
        </div>
      ) : (
        files.map((file) => (
          <TreeNode
            key={file.path}
            file={file}
            level={0}
            onFileSelect={onFileSelect}
            onDirectoryClick={onDirectoryClick}
            selectedFile={selectedFile}
            onDelete={onDelete}
            onRename={onRename}
            
          />
        ))
      )}
    </div>
  )
})