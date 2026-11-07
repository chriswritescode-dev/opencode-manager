import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface SandboxedHtmlFrameProps {
  src: string
  title: string
  reloadKey?: string | number
  className?: string
  onLoad?: () => void
  style?: { height?: number }
}

/**
 * Renders untrusted HTML in an iframe restricted to `allow-scripts` without same-origin access.
 * Owns the artifact sandbox policy so callers cannot widen it; remounts when `reloadKey` changes.
 */
export const SandboxedHtmlFrame = forwardRef<HTMLIFrameElement, SandboxedHtmlFrameProps>(
  function SandboxedHtmlFrame({ src, title, reloadKey, className, onLoad, style }, ref) {
    return (
      <iframe
        ref={ref}
        key={reloadKey}
        src={src}
        title={title}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
        onLoad={onLoad}
        style={style}
        className={cn('block w-full border-0 bg-white', className)}
      />
    )
  },
)
