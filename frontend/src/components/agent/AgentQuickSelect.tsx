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

interface AgentQuickSelectProps {
  opcodeUrl: string | null | undefined
  directory?: string
  currentAgent: string
  onAgentChange: (agent: string) => void
  isBashMode?: boolean
  disabled?: boolean
}

const getAgentStyles = (agent: string) => {
  const lowerAgent = agent.toLowerCase()
  if (lowerAgent === 'plan') {
    return {
      color: 'text-yellow-600 dark:text-yellow-500',
      bg: 'bg-yellow-500/20 border-yellow-400 hover:bg-yellow-500/30 hover:border-yellow-300',
      shadow: 'shadow-yellow-500/20 hover:shadow-yellow-500/30',
    }
  }
  if (lowerAgent === 'build') {
    return {
      color: 'text-green-600 dark:text-green-500',
      bg: 'bg-green-500/20 border-green-400 hover:bg-green-500/30 hover:border-green-300',
      shadow: 'shadow-green-500/20 hover:shadow-green-500/30',
    }
  }
  return {
    color: 'text-blue-600 dark:text-blue-500',
    bg: 'bg-blue-500/20 border-blue-400 hover:bg-blue-500/30 hover:border-blue-300',
    shadow: 'shadow-blue-500/20 hover:shadow-blue-500/30',
  }
}

const bashStyles = {
  color: 'text-purple-700 dark:text-purple-300',
  bg: 'bg-purple-500/20 border-purple-400',
  shadow: 'shadow-purple-500/20 hover:shadow-purple-500/30',
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

  const handleToggle = () => {
    if (primaryAgents.length === 0) return
    
    const currentIndex = primaryAgents.findIndex(
      (a) => a.name.toLowerCase() === currentAgent.toLowerCase()
    )
    const nextIndex = (currentIndex + 1) % primaryAgents.length
    onAgentChange(primaryAgents[nextIndex].name)
  }

  const handleSelect = (agentName: string) => {
    onAgentChange(agentName)
  }

  const styles = isBashMode ? bashStyles : getAgentStyles(currentAgent)
  const displayName = isBashMode ? 'Bash' : capitalize(currentAgent)

  const buttonContent = (
    <button
      data-toggle-mode
      onClick={primaryAgents.length <= 2 ? handleToggle : undefined}
      disabled={disabled}
      className={`px-2 md:px-3.5 py-1 h-[36px] rounded-lg text-sm font-medium border min-w-[48px] max-w-[80px] md:max-w-[100px] flex items-center justify-center transition-all duration-200 active:scale-95 hover:scale-105 shadow-md ${styles.bg} ${styles.color} ${styles.shadow}`}
    >
      <span className="truncate">{displayName}</span>
    </button>
  )

  if (primaryAgents.length <= 2) {
    return buttonContent
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {buttonContent}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {primaryAgents.map((agent) => {
          const agentStyles = getAgentStyles(agent.name)
          const isSelected = agent.name.toLowerCase() === currentAgent.toLowerCase()
          
          return (
            <DropdownMenuItem
              key={agent.name}
              onClick={() => handleSelect(agent.name)}
              className="flex items-center justify-between"
            >
              <div className="flex flex-col">
                <span className={`font-medium ${agentStyles.color}`}>
                  {capitalize(agent.name)}
                </span>
                {agent.description && (
                  <span className="text-xs text-muted-foreground truncate max-w-[160px]">
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
