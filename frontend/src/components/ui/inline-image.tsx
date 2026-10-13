import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/**
 * Renders an image as a bounded thumbnail button that opens a full-size preview dialog.
 * Falls back to a muted alt-text span (or nothing) when the image fails to load.
 */
export function InlineImage({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  if (failed) {
    return alt ? <span className="text-xs text-muted-foreground">{alt}</span> : null
  }

  return (
    <>
      <button
        type="button"
        aria-label={alt ? `Expand image: ${alt}` : 'Expand image'}
        onClick={() => setOpen(true)}
        className="inline-flex"
      >
        <img
          src={src}
          alt={alt ?? ''}
          loading="lazy"
          onError={() => setFailed(true)}
          className={cn(
            'max-w-full max-h-80 rounded-lg border border-border object-contain cursor-zoom-in',
            className,
          )}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-auto max-w-none p-2">
          <DialogTitle className="sr-only">{alt ?? 'Image'}</DialogTitle>
          <img src={src} alt={alt ?? ''} className="max-w-[95vw] max-h-[90vh] object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}
