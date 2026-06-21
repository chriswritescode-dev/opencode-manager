import { cn } from '@/lib/utils'

interface PreviewHtmlButtonProps {
  onClick: () => void
  className?: string
}

export function PreviewHtmlButton({ onClick, className }: PreviewHtmlButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded bg-card hover:bg-card-hover text-muted-foreground hover:text-foreground text-xs',
        className,
      )}
      title="Preview HTML artifact"
    >
      Preview HTML
    </button>
  )
}
