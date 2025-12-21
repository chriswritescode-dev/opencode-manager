import { memo, type ReactNode } from 'react'
import { X, VolumeX, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type FloatingActionVariant = 'clear' | 'stop-audio' | 'custom'

interface FloatingActionButtonProps {
  variant: FloatingActionVariant
  onClick: () => void
  visible: boolean
  loading?: boolean
  icon?: ReactNode
  label?: string
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  className?: string
}

const variantConfig: Record<FloatingActionVariant, { icon: ReactNode; label: string; colors: string }> = {
  'clear': {
    icon: <X className="w-5 h-5" />,
    label: 'Clear',
    colors: 'bg-muted hover:bg-destructive/20 text-muted-foreground hover:text-destructive border-border hover:border-destructive/50'
  },
  'stop-audio': {
    icon: <VolumeX className="w-5 h-5" />,
    label: 'Stop Audio',
    colors: 'bg-destructive/90 hover:bg-destructive text-destructive-foreground border-destructive'
  },
  'custom': {
    icon: null,
    label: '',
    colors: 'bg-muted hover:bg-muted-foreground/20 text-muted-foreground border-border'
  }
}

const positionClasses: Record<NonNullable<FloatingActionButtonProps['position']>, string> = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4'
}

export const FloatingActionButton = memo(function FloatingActionButton({
  variant,
  onClick,
  visible,
  loading = false,
  icon,
  label,
  position = 'top-right',
  className
}: FloatingActionButtonProps) {
  const config = variantConfig[variant]
  const displayIcon = icon ?? config.icon
  const displayLabel = label ?? config.label

  if (!visible) return null

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'fixed z-50 flex items-center gap-2 px-4 py-3 rounded-full border shadow-lg backdrop-blur-sm transition-all duration-200',
        'min-w-[48px] min-h-[48px]',
        'active:scale-95',
        config.colors,
        positionClasses[position],
        loading && 'opacity-70 cursor-not-allowed',
        className
      )}
      aria-label={displayLabel}
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        displayIcon
      )}
      {displayLabel && (
        <span className="text-sm font-medium hidden sm:inline">{displayLabel}</span>
      )}
    </button>
  )
})
