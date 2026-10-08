import { useMemo } from 'react'
import { Check } from 'lucide-react'

const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAgents } from '@/hooks/useOpenCode'
import { getAgentStyleVars } from '@/lib/agent-colors'
import { getPrimaryAgents } from '@/lib/primaryAgents'

interface AgentQuickSelectProps {
  directory?: string
  currentAgent: string
  onAgentChange: (agent: string) => void
  isBashMode?: boolean
}

interface AgentInfo {
  id: string
  name: string
  color?: string
  description?: string
  mode?: string
  hidden?: boolean
}

const findAgent = (agents: AgentInfo[], agentId: string): AgentInfo | undefined => {
  return agents.find(a => a.id.toLowerCase() === agentId.toLowerCase())
}

export function AgentQuickSelect({
  directory,
  currentAgent,
  onAgentChange,
  isBashMode = false,
}: AgentQuickSelectProps) {
  const { data: agents = [] } = useAgents(directory)

  const primaryAgents = useMemo(() => getPrimaryAgents(agents), [agents])

  const handleSelect = (agentId: string) => {
    onAgentChange(agentId)
  }

  const currentAgentInfo = findAgent(agents, currentAgent)
  const styleVars = isBashMode 
    ? getAgentStyleVars('plan') 
    : getAgentStyleVars(currentAgent, currentAgentInfo?.color)
  const displayName = isBashMode ? 'Bash' : capitalize(currentAgentInfo?.name ?? currentAgent)

  const buttonContent = (
    <button
      style={styleVars as React.CSSProperties}
      className="px-2 md:px-3.5 py-1 h-[36px] rounded-lg text-sm font-medium border min-w-[56px] max-w-[80px] md:max-w-[100px] flex-shrink-0 flex items-center justify-center transition-all duration-200 active:scale-95 hover:scale-105 shadow-md text-[var(--agent-color)] bg-[var(--agent-bg)] border-[var(--agent-border)] hover:bg-[var(--agent-bg-hover)] hover:border-[var(--agent-border-hover)] shadow-[var(--agent-shadow)] hover:shadow-[var(--agent-shadow-hover)]"
    >
      <span className="truncate">{displayName}</span>
    </button>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {buttonContent}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {primaryAgents.map((agent) => {
          const apiColor = agent.color
          const itemStyleVars = getAgentStyleVars(agent.id, apiColor)
          const isSelected = agent.id.toLowerCase() === currentAgent.toLowerCase()
          
          return (
            <DropdownMenuItem
              key={agent.id}
              onClick={() => handleSelect(agent.id)}
              className="group flex items-center justify-between"
            >
              <div className="flex flex-col min-w-0">
                <span 
                  className="font-medium"
                  style={{ color: itemStyleVars['--agent-color'] }}
                >
                  {capitalize(agent.name)}
                </span>
                {agent.description && (
                  <span className="text-xs text-muted-foreground line-clamp-2 group-hover:line-clamp-none">
                    {agent.description}
                  </span>
                )}
              </div>
              {isSelected && <Check className="h-4 w-4 flex-shrink-0 ml-2" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
