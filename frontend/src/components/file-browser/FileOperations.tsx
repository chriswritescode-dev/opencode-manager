import { useState, memo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Upload, Plus, FolderPlus, FilePlus } from 'lucide-react'

interface FileOperationsProps {
  onUpload: (files: FileList) => void
  onCreate: (name: string, type: 'file' | 'folder') => void
}

export const FileOperations = memo(function FileOperations({ onUpload, onCreate }: FileOperationsProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createType, setCreateType] = useState<'file' | 'folder'>('file')
  const [createName, setCreateName] = useState('')

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
      <div className="relative">
        <input
          type="file"
          id="file-upload"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={handleFileSelect}
          multiple
        />
        <Button variant="outline" size="sm" asChild>
          <label htmlFor="file-upload" className="cursor-pointer flex items-center gap-2">
            <Upload className="w-4 h-4" />
            <span className='hidden sm:inline'>Upload</span>
          </label>
        </Button>
      </div>

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
