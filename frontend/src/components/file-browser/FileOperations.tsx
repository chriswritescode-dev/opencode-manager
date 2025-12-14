import { useState, memo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Upload, Plus, FolderPlus, FilePlus, File, Folder } from 'lucide-react'
import { useMobile } from '@/hooks/useMobile'

interface FileOperationsProps {
  onUpload: (files: FileList) => void
  onCreate: (name: string, type: 'file' | 'folder') => void
}

export const FileOperations = memo(function FileOperations({ onUpload, onCreate }: FileOperationsProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createType, setCreateType] = useState<'file' | 'folder'>('file')
  const [createName, setCreateName] = useState('')
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const isMobile = useMobile()

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0) {
      onUpload(files)
    }
    event.target.value = ''
  }

  const handleCreate = () => {
    if (createName.trim()) {
      onCreate(createName.trim(), createType)
      setCreateName('')
      setCreateDialogOpen(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
        multiple
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
        {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
      />
      
      {isMobile ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Upload className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <File className="w-4 h-4 mr-2" />
              Files
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
              <Folder className="w-4 h-4 mr-2" />
              Folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline ml-1">Upload</span>
        </Button>
      )}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="w-4 h-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <Select value={createType} onValueChange={(value: 'file' | 'folder') => setCreateType(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="file">
                  <div className="flex items-center gap-2">
                    <FilePlus className="w-4 h-4" />
                    File
                  </div>
                </SelectItem>
                <SelectItem value="folder">
                  <div className="flex items-center gap-2">
                    <FolderPlus className="w-4 h-4" />
                    Folder
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            
            <Input
              placeholder={`${createType === 'file' ? 'File' : 'Folder'} name`}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
            />
            
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={!createName.trim()}>
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
})
