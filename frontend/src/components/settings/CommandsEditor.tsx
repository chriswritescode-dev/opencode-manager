import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import type { OpenCodeCommandConfig } from '@opencode-manager/shared/opencode'
import type { OpenCodeCommandPatch, OpenCodeDirectoryFileInfo } from '@/api/types/settings'
import { CommandDialog } from './CommandDialog'
import { UploadFolderButton } from './UploadFolderButton'
import { DirectoryFilesList } from './DirectoryFilesList'

interface CommandsEditorProps {
  commands: Record<string, OpenCodeCommandConfig>
  directoryCommands?: OpenCodeDirectoryFileInfo[]
  onSave: (name: string, command: OpenCodeCommandPatch, previousName?: string) => void
  onDelete: (name: string) => void
}

/**
 * Renders configured commands alongside command files discovered in the workspace directory,
 * providing add, edit and delete entry points against the managed config.
 */
export function CommandsEditor({ commands, directoryCommands = [], onSave, onDelete }: CommandsEditorProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingCommand, setEditingCommand] = useState<{ name: string; command: OpenCodeCommandConfig } | null>(null)
  const hasCommands = Object.keys(commands).length > 0 || directoryCommands.length > 0

  const handleCommandSubmit = (name: string, command: OpenCodeCommandPatch) => {
    onSave(name, command, editingCommand?.name)
    setEditingCommand(null)
    setIsCreateDialogOpen(false)
  }

  const startEdit = (name: string, command: OpenCodeCommandConfig) => {
    setEditingCommand({ name, command })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <UploadFolderButton kind="commands" />
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
        isEmpty={!hasCommands}
        emptyTitle="No commands configured"
        emptyHint="Add your first command to get started."
        maxHeightClassName="max-h-[calc(100dvh-300px)] sm:max-h-[420px]"
      >
        {Object.entries(commands).map(([name, command]) => (
          <SettingsListRow
            key={name}
            title={name}
            description={command.description}
            badges={
              command.agent && <Badge variant="outline" className="shrink-0">{command.agent}</Badge>
            }
            onClick={() => startEdit(name, command)}
            primaryAction={{ label: 'Edit', onClick: () => startEdit(name, command) }}
            actions={[{ label: 'Delete', destructive: true, onClick: () => onDelete(name) }]}
            actionsLabel={`Actions for ${name}`}
          />
        ))}
        <DirectoryFilesList kind="commands" files={directoryCommands} />
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
