import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import { AgentDialog } from './AgentDialog'

interface Agent {
  prompt?: string
  description?: string
  mode?: 'subagent' | 'primary' | 'all'
  temperature?: number
  topP?: number
  top_p?: number
  model?: string
  tools?: Record<string, boolean>
  permission?: {
    edit?: 'ask' | 'allow' | 'deny'
    bash?: 'ask' | 'allow' | 'deny' | Record<string, 'ask' | 'allow' | 'deny'>
    webfetch?: 'ask' | 'allow' | 'deny'
  }
  disable?: boolean
  [key: string]: unknown
}

interface AgentsEditorProps {
  agents: Record<string, Agent>
  onChange: (agents: Record<string, Agent>) => void
}

export function AgentsEditor({ agents, onChange }: AgentsEditorProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<{ name: string; agent: Agent } | null>(null)

  const handleAgentSubmit = (name: string, agent: Agent) => {
    if (editingAgent) {
      const updatedAgents = { ...agents }
      delete updatedAgents[editingAgent.name]
      updatedAgents[name] = agent
      onChange(updatedAgents)
      setEditingAgent(null)
    } else {
      const updatedAgents = {
        ...agents,
        [name]: agent
      }
      onChange(updatedAgents)
      setIsCreateDialogOpen(false)
    }
  }

  const deleteAgent = (name: string) => {
    const updatedAgents = { ...agents }
    delete updatedAgents[name]
    onChange(updatedAgents)
  }

  const startEdit = (name: string, agent: Agent) => {
    setEditingAgent({ name, agent })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
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
        isEmpty={Object.keys(agents).length === 0}
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
                {agent.disable && <Badge variant="secondary" className="shrink-0">Disabled</Badge>}
              </>
            }
            onClick={() => startEdit(name, agent)}
            primaryAction={{ label: 'Edit', onClick: () => startEdit(name, agent) }}
            actions={[{ label: 'Delete', destructive: true, onClick: () => deleteAgent(name) }]}
            actionsLabel={`Actions for ${name}`}
          />
        ))}
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
