import { useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { scrollSectionIntoView } from '@/lib/settingsScroll'

interface SettingsDisclosureProps {
  title: string
  icon?: ReactNode
  meta?: ReactNode
  isOpen?: boolean
  onToggle?: () => void
  contentClassName?: string
  children: ReactNode
}

export function SettingsDisclosure({
  title,
  icon,
  meta,
  isOpen: controlledOpen,
  onToggle,
  contentClassName,
  children,
}: SettingsDisclosureProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpen = controlledOpen ?? uncontrolledOpen
  const contentId = useId()
  const headerRef = useRef<HTMLButtonElement>(null)

  const handleToggle = () => {
    const nextOpen = !isOpen
    if (onToggle) {
      onToggle()
    } else {
      setUncontrolledOpen(nextOpen)
    }
    if (nextOpen) {
      setTimeout(() => scrollSectionIntoView(headerRef.current), 0)
    }
  }

  return (
    <div className="border-t border-border pt-4">
      <button
        ref={headerRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-2 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h3 className="text-sm font-semibold truncate">{title}</h3>
          {meta}
        </div>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')} />
      </button>
      <div id={contentId} className={cn('pt-2', isOpen ? 'block' : 'hidden', contentClassName)}>
        {children}
      </div>
    </div>
  )
}
