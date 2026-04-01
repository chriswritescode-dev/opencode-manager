import { Button } from '@/components/ui/button'
import { Code } from 'lucide-react'
import { useLSPStatus } from '@/hooks/useLSPStatus'

interface LspStatusButtonProps {
  opcodeUrl: string | null | undefined
  directory?: string
  onClick: () => void
}

export function LspStatusButton({ opcodeUrl, directory, onClick }: LspStatusButtonProps) {
  const { data } = useLSPStatus(opcodeUrl, directory)

  const hasActiveServers = data && data.length > 0 && data.some(server => server.status === 'connected')

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="hidden md:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
    >
      <Code className={`w-4 h-4 sm:mr-2 ${hasActiveServers ? 'text-green-500' : ''}`} />
      <span className="hidden sm:inline">LSP</span>
    </Button>
  )
}
