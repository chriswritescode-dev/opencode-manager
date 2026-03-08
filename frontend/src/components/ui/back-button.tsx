import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { cn } from '@/lib/utils'

interface BackButtonProps {
  to?: string
  className?: string
}

export function BackButton({ to = '/', className = '' }: BackButtonProps) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(to)}
      className={cn(
        'rounded-lg border border-border/70 bg-panel/70 px-3 py-1.5 text-sm text-muted-foreground transition-all duration-200 hover:scale-105 hover:bg-accent hover:text-foreground',
        className
      )}
    >
      <ArrowLeft className="w-4 h-4" />
    </button>
  )
}
