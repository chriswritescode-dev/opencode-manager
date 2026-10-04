import type { ReactNode } from 'react'

interface IconToggleButtonProps {
  active: boolean
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

export function IconToggleButton({ active, label, disabled = false, onClick, children }: IconToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`p-2 rounded-lg transition-all duration-200 active:scale-95 hover:scale-105 shadow-md border disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:scale-100 ${
        active
          ? 'bg-highlight hover:bg-highlight/90 text-highlight-foreground border-highlight'
          : 'bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground border-border'
      }`}
    >
      {children}
    </button>
  )
}
