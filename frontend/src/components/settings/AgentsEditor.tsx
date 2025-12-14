import { useState } from 'react'
import { Plus, Trash2, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
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
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Agents</h3>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className='mr-1 h-6'>
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <AgentDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
            onSubmit={handleAgentSubmit}
          />
        </Dialog>
      </div>

      {Object.keys(agents).length === 0 ? (
        <Card>
          <CardContent className="p-2 sm:p-8 text-center">
            <p className="text-muted-foreground">No agents configured. Add your first agent to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {Object.entries(agents).map(([name, agent]) => (
            <Card key={name}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(name, agent)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteAgent(name)}
                      className="text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-2'>
                <div className="space-y-2">
                  {agent.description && (
                    <p className="text-sm text-muted-foreground">{agent.description}</p>
                  )}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Mode: {agent.mode}</p>
                    {agent.temperature !== undefined && <p>Temperature: {agent.temperature}</p>}
                    {agent.topP !== undefined && <p>Top P: {agent.topP}</p>}
                    {agent.model && <p>Model: {agent.model}</p>}
                    {agent.disable && <p>Status: Disabled</p>}
                  </div>
                  {agent.prompt && (
                    <div className="mt-2 bg-muted rounded text-xs font-mono overflow-y-auto p-1 rounded-lg">
                      {agent.prompt}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AgentDialog
        open={!!editingAgent}
        onOpenChange={() => setEditingAgent(null)}
        onSubmit={handleAgentSubmit}
        editingAgent={editingAgent}
      />
    </div>
  )
}
