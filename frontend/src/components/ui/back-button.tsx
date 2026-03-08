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
        'inline-flex items-center justify-center rounded-[calc(var(--radius)-0.125rem)] border border-border/70 bg-panel/80 px-2.5 py-1.5 text-muted-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)] transition-[color,background-color,border-color,transform] hover:border-border hover:bg-accent hover:text-foreground active:translate-y-px',
        className
      )}
    >
      <ArrowLeft className="w-4 h-4" />
    </button>
  )
}
