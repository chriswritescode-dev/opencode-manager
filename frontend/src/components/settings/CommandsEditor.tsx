import { useState } from 'react'
import { FolderUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import { CommandDialog } from './CommandDialog'
import { Input } from '@/components/ui/input'
import { settingsApi } from '@/api/settings'
import { toast } from 'sonner'

interface Command {
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
  topP?: number
}

interface CommandsEditorProps {
  commands: Record<string, Command>
  onChange: (commands: Record<string, Command>) => void
}

export function CommandsEditor({ commands, onChange }: CommandsEditorProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingCommand, setEditingCommand] = useState<{ name: string; command: Command } | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const handleCommandSubmit = (name: string, command: Command) => {
    if (editingCommand) {
      const updatedCommands = { ...commands }
      delete updatedCommands[editingCommand.name]
      updatedCommands[name] = command
      onChange(updatedCommands)
      setEditingCommand(null)
    } else {
      const updatedCommands = {
        ...commands,
        [name]: command
      }
      onChange(updatedCommands)
      setIsCreateDialogOpen(false)
    }
  }

  const deleteCommand = (name: string) => {
    const updatedCommands = { ...commands }
    delete updatedCommands[name]
    onChange(updatedCommands)
  }

  const startEdit = (name: string, command: Command) => {
    setEditingCommand({ name, command })
  }

  const importCommandDirectory = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    try {
      setIsUploading(true)
      const result = await settingsApi.installOpenCodeDirectoryFiles({ kind: 'commands', files })
      toast.success(`Uploaded ${result.filesInstalled.length} command file${result.filesInstalled.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload commands')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" disabled={isUploading} asChild>
          <label className="cursor-pointer">
            <FolderUp className="h-4 w-4 mr-1" />
            {isUploading ? 'Uploading...' : 'Upload Folder'}
            <Input
              type="file"
              accept=".md,text/markdown"
              className="sr-only"
              multiple
              disabled={isUploading}
              {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
              onChange={importCommandDirectory}
            />
          </label>
        </Button>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Command
            </Button>
          </DialogTrigger>
          <CommandDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
            onSubmit={handleCommandSubmit}
          />
        </Dialog>
      </div>

      <SettingsList
        isEmpty={Object.keys(commands).length === 0}
        emptyTitle="No commands configured"
        emptyHint="Add your first command to get started."
        maxHeightClassName="max-h-[calc(100dvh-300px)] sm:max-h-[420px]"
      >
        {Object.entries(commands).map(([name, command]) => (
          <SettingsListRow
            key={name}
            title={`/${name}`}
            description={command.description}
            badges={
              command.agent && <Badge variant="outline" className="shrink-0">{command.agent}</Badge>
            }
            onClick={() => startEdit(name, command)}
            primaryAction={{ label: 'Edit', onClick: () => startEdit(name, command) }}
            actions={[{ label: 'Delete', destructive: true, onClick: () => deleteCommand(name) }]}
            actionsLabel={`Actions for /${name}`}
          />
        ))}
      </SettingsList>

      <CommandDialog
        open={!!editingCommand}
        onOpenChange={() => setEditingCommand(null)}
        onSubmit={handleCommandSubmit}
        editingCommand={editingCommand}
      />
    </div>
  )
}
