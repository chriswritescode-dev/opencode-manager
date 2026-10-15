import type { ReactNode } from 'react'

interface ToolMenuItemContentProps {
  icon: ReactNode
  title: string
  detail?: string
}

export function ToolMenuItemContent({ icon, title, detail }: ToolMenuItemContentProps) {
  return (
    <span className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span>{title}</span>
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </span>
  )
}
