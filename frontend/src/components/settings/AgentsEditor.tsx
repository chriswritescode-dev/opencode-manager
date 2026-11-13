import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import type { OpenCodeAgentConfig } from '@opencode-manager/shared/opencode'
import type { OpenCodeAgentPatch, OpenCodeDirectoryFileInfo } from '@/api/types/settings'
import { AgentDialog } from './AgentDialog'
import { UploadFolderButton } from './UploadFolderButton'
import { DirectoryFilesList } from './DirectoryFilesList'

interface AgentsEditorProps {
  agents: Record<string, OpenCodeAgentConfig>
  directoryAgents?: OpenCodeDirectoryFileInfo[]
  onSave: (name: string, agent: OpenCodeAgentPatch) => void
  onDelete: (name: string) => void
}

export function AgentsEditor({ agents, directoryAgents = [], onSave, onDelete }: AgentsEditorProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<{ name: string; agent: OpenCodeAgentConfig } | null>(null)
  const hasAgents = Object.keys(agents).length > 0 || directoryAgents.length > 0

  const handleAgentSubmit = (name: string, agent: OpenCodeAgentPatch) => {
    onSave(name, agent)
    setEditingAgent(null)
    setIsCreateDialogOpen(false)
  }

  const startEdit = (name: string, agent: OpenCodeAgentConfig) => {
    setEditingAgent({ name, agent })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <UploadFolderButton kind="agents" />
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Agent
            </Button>
          </DialogTrigger>
          <AgentDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
            onSubmit={handleAgentSubmit}
          />
        </Dialog>
      </div>

      <SettingsList
        isEmpty={!hasAgents}
        emptyTitle="No agents configured"
        emptyHint="Add your first agent to get started."
        maxHeightClassName="max-h-[calc(100dvh-300px)] sm:max-h-[420px]"
      >
        {Object.entries(agents).map(([name, agent]) => (
          <SettingsListRow
            key={name}
            title={name}
            description={agent.description}
            badges={
              <>
                {agent.mode && <Badge variant="outline" className="shrink-0">{agent.mode}</Badge>}
                {agent.disabled && <Badge variant="secondary" className="shrink-0">Disabled</Badge>}
              </>
            }
            onClick={() => startEdit(name, agent)}
            primaryAction={{ label: 'Edit', onClick: () => startEdit(name, agent) }}
            actions={[{ label: 'Delete', destructive: true, onClick: () => onDelete(name) }]}
            actionsLabel={`Actions for ${name}`}
          />
        ))}
        <DirectoryFilesList kind="agents" files={directoryAgents} />
      </SettingsList>

      <AgentDialog
        open={!!editingAgent}
        onOpenChange={() => setEditingAgent(null)}
        onSubmit={handleAgentSubmit}
        editingAgent={editingAgent}
      />
    </div>
  )
}
