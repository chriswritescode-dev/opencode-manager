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

interface AgentQuickSelectProps {
  opcodeUrl: string | null | undefined
  directory?: string
  currentAgent: string
  onAgentChange: (agent: string) => void
  isBashMode?: boolean
  disabled?: boolean
}

interface AgentInfo {
  name: string
  color?: string
  description?: string
  mode?: string
  hidden?: boolean
}

const findAgentColor = (agents: AgentInfo[], agentName: string): string | undefined => {
  return agents.find(a => a.name.toLowerCase() === agentName.toLowerCase())?.color
}

const bashStyleVars: Record<string, string> = {
  '--agent-color-light': '#a753ae',
  '--agent-color-dark': '#edb2f1',
  '--agent-bg-light': 'rgba(167, 83, 174, 0.2)',
  '--agent-bg-dark': 'rgba(237, 178, 241, 0.2)',
  '--agent-bg-hover-light': 'rgba(167, 83, 174, 0.3)',
  '--agent-bg-hover-dark': 'rgba(237, 178, 241, 0.3)',
  '--agent-border-light': 'rgba(167, 83, 174, 0.6)',
  '--agent-border-dark': 'rgba(237, 178, 241, 0.6)',
  '--agent-border-hover-light': 'rgba(167, 83, 174, 0.5)',
  '--agent-border-hover-dark': 'rgba(237, 178, 241, 0.5)',
  '--agent-shadow-light': 'rgba(167, 83, 174, 0.2)',
  '--agent-shadow-dark': 'rgba(237, 178, 241, 0.2)',
  '--agent-shadow-hover-light': 'rgba(167, 83, 174, 0.3)',
  '--agent-shadow-hover-dark': 'rgba(237, 178, 241, 0.3)',
}

export function AgentQuickSelect({
  opcodeUrl,
  directory,
  currentAgent,
  onAgentChange,
  isBashMode = false,
  disabled = false,
}: AgentQuickSelectProps) {
  const { data: agents = [] } = useAgents(opcodeUrl, directory)

  const primaryAgents = useMemo(() => {
    return agents.filter(
      (agent) =>
        (agent.mode === 'primary' || agent.mode === 'all') &&
        !agent.hidden
    )
  }, [agents])

  const handleSelect = (agentName: string) => {
    onAgentChange(agentName)
  }

  const styleVars = isBashMode 
    ? bashStyleVars 
    : getAgentStyleVars(currentAgent, findAgentColor(agents, currentAgent))
  const displayName = isBashMode ? 'Bash' : capitalize(currentAgent)

  const buttonContent = (
    <button
      data-toggle-mode
      disabled={disabled}
      style={styleVars as React.CSSProperties}
      className="px-2 md:px-3.5 py-1 h-[36px] rounded-lg text-sm font-medium border min-w-[56px] max-w-[80px] md:max-w-[100px] flex-shrink-0 flex items-center justify-center transition-all duration-200 active:scale-95 hover:scale-105 shadow-md text-[var(--agent-color-light)] dark:text-[var(--agent-color-dark)] bg-[var(--agent-bg-light)] dark:bg-[var(--agent-bg-dark)] border-[var(--agent-border-light)] dark:border-[var(--agent-border-dark)] hover:bg-[var(--agent-bg-hover-light)] dark:hover:bg-[var(--agent-bg-hover-dark)] hover:border-[var(--agent-border-hover-light)] dark:hover:border-[var(--agent-border-hover-dark)] shadow-[var(--agent-shadow-light)] dark:shadow-[var(--agent-shadow-dark)] hover:shadow-[var(--agent-shadow-hover-light)] dark:hover:shadow-[var(--agent-shadow-hover-dark)]"
    >
      <span className="truncate">{displayName}</span>
    </button>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {buttonContent}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {primaryAgents.map((agent) => {
          const apiColor = agent.color
          const itemStyleVars = getAgentStyleVars(agent.name, apiColor)
          const isSelected = agent.name.toLowerCase() === currentAgent.toLowerCase()
          
          return (
            <DropdownMenuItem
              key={agent.name}
              onClick={() => handleSelect(agent.name)}
              className="group flex items-center justify-between"
            >
              <div className="flex flex-col min-w-0">
                <span 
                  className="font-medium"
                  style={{ color: itemStyleVars['--agent-color-light'] }}
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
