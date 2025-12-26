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
    colors: 'bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 border-2 border-red-500/60 hover:border-red-400 shadow-lg shadow-red-500/30 hover:shadow-red-500/50 ring-2 ring-red-500/20 hover:ring-red-500/40 text-destructive-foreground'
  },
  'stop-audio': {
    icon: <VolumeX className="w-5 h-5" />,
    label: 'Stop Audio',
    colors: 'bg-gradient-to-br from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 border-2 border-red-600/80 hover:border-red-500 shadow-2xl shadow-red-600/40 hover:shadow-red-600/60 ring-2 ring-red-600/30 hover:ring-red-600/50 animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite] text-destructive-foreground',
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
        'fixed z-50 flex items-center gap-2 px-4 py-2 rounded-xl backdrop-blur-md transition-all duration-200',
        'min-w-[48px] min-h-[48px]',
        'active:scale-95 hover:scale-105',
        'transition-transform',
        config.colors,
        positionClasses[position],
        loading && 'opacity-70 cursor-not-allowed grayscale',
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
