import { useState } from 'react'
import { Plus, Trash2, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { CommandDialog } from './CommandDialog'

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Commands</h3>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className='mr-1 h-6'>
              <Plus className="h-4 w-4" />
             
            </Button>
          </DialogTrigger>
          <CommandDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
            onSubmit={handleCommandSubmit}
          />
        </Dialog>
      </div>

      {Object.keys(commands).length === 0 ? (
        <Card>
          <CardContent className="p-2 sm:p-8 text-center">
            <p className="text-muted-foreground">No commands configured. Add your first command to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {Object.entries(commands).map(([name, command]) => (
            <Card key={name}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">/{name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(name, command)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteCommand(name)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-2'>
                <div className="space-y-2">
                  {command.description && (
                    <p className="text-sm text-muted-foreground">{command.description}</p>
                  )}
<div className="text-xs text-muted-foreground space-y-1">
                     {command.agent && <p>Agent: {command.agent}</p>}
                     {command.model && <p>Model: {command.model}</p>}
                     {command.topP !== undefined && <p>Top P: {command.topP}</p>}
                     {command.subtask && <p>Subtask: Yes</p>}
                   </div>
                  <div className="mt-2 bg-muted rounded text-xs font-mono overflow-y-auto p-1 rounded-lg">
                    {command.template}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CommandDialog
        open={!!editingCommand}
        onOpenChange={() => setEditingCommand(null)}
        onSubmit={handleCommandSubmit}
        editingCommand={editingCommand}
      />
    </div>
  )
}
