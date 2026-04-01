import * as React from 'react'

import { cn } from '@/lib/utils'

export interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
}

export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <header
        ref={ref}
        className={cn(
          'sticky top-0 z-10 border-b border-border/60 bg-background/90 shadow-[0_10px_30px_-24px_color-mix(in_oklab,var(--foreground)_55%,transparent)] supports-[backdrop-filter]:bg-background/76 backdrop-blur-xl pt-safe',
          className
        )}
        {...props}
      >
        {children}
      </header>
    )
  }
)

PageHeader.displayName = 'PageHeader'
