import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/**
 * Renders an image as a bounded thumbnail that opens a full-size preview dialog when expandable.
 * Falls back to a muted alt-text span (or nothing) when the image fails to load, retrying when the source changes.
 */
export function InlineImage({
  src,
  alt,
  className,
  expandable = true,
}: {
  src: string
  alt?: string
  className?: string
  expandable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = failedSrc === src

  if (failed) {
    return alt ? <span className="text-xs text-muted-foreground">{alt}</span> : null
  }

  const image = (
    <img
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => setFailedSrc(src)}
      className={cn(
        'max-w-full max-h-80 rounded-lg border border-border object-contain',
        expandable && 'cursor-zoom-in',
        className,
      )}
    />
  )

  if (!expandable) {
    return image
  }

  return (
    <>
      <button
        type="button"
        aria-label={alt ? `Expand image: ${alt}` : 'Expand image'}
        onClick={() => setOpen(true)}
        className="inline-flex"
      >
        {image}
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
