import { cn } from '@/lib/utils'
import { normalizeHtmlPreviewDocument } from '@/lib/htmlArtifacts'

interface HtmlPreviewFrameProps {
  title: string
  src?: string
  srcDoc?: string
  className?: string
}

export function HtmlPreviewFrame({ title, src, srcDoc, className }: HtmlPreviewFrameProps) {
  const sandbox = src ? 'allow-scripts allow-same-origin' : 'allow-scripts'
  const normalizedSrcDoc = srcDoc ? normalizeHtmlPreviewDocument(srcDoc) : undefined
  return (
    <iframe
      title={title}
      src={src}
      srcDoc={normalizedSrcDoc}
      sandbox={sandbox}
      referrerPolicy="no-referrer"
      scrolling="yes"
      className={cn('block h-full max-h-full min-h-0 w-full max-w-full border-0 bg-white', className)}
    />
  )
}
