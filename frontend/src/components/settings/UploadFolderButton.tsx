import { useRef, useState } from 'react'
import { Upload, FileUp, FolderUp, ChevronDown } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { settingsApi } from '@/api/settings'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { DIRECTORY_INPUT_PROPS, getUploadItemsFromFileList } from '@/lib/directoryUpload'

const KIND_NOUN: Record<'agents' | 'commands', string> = {
  agents: 'agent',
  commands: 'command',
}

interface UploadFolderButtonProps {
  kind: 'agents' | 'commands'
}

export function UploadFolderButton({ kind }: UploadFolderButtonProps) {
  const queryClient = useQueryClient()
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const noun = KIND_NOUN[kind]

  const openPicker = (inputRef: React.RefObject<HTMLInputElement | null>) => {
    requestAnimationFrame(() => inputRef.current?.click())
  }

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    const items = fileList ? getUploadItemsFromFileList(fileList) : []
    event.target.value = ''
    if (items.length === 0) {
      return
    }

    const markdownItems = items.filter((item) => item.relativePath.toLowerCase().endsWith('.md'))
    if (markdownItems.length === 0) {
      toast.error(`No markdown ${kind} files found`)
      return
    }

    try {
      setIsUploading(true)
      const result = await settingsApi.installOpenCodeDirectoryFiles({ kind, items: markdownItems })
      invalidateConfigCaches(queryClient)
      toast.success(`Uploaded ${result.filesInstalled.length} ${noun} file${result.filesInstalled.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to upload ${kind}`)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={isUploading}>
            <Upload className="h-4 w-4 mr-1" />
            {isUploading ? 'Uploading...' : 'Upload'}
            <ChevronDown className="h-4 w-4 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openPicker(fileInputRef)}>
            <FileUp className="h-4 w-4 mr-2" />
            Upload File
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openPicker(folderInputRef)}>
            <FolderUp className="h-4 w-4 mr-2" />
            Upload Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown"
        className="sr-only"
        multiple
        disabled={isUploading}
        onChange={handleChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept=".md,text/markdown"
        className="sr-only"
        multiple
        disabled={isUploading}
        {...DIRECTORY_INPUT_PROPS}
        onChange={handleChange}
      />
    </>
  )
}
