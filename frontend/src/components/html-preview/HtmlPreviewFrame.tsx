import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { normalizeHtmlPreviewDocument } from '@/lib/htmlArtifacts'

interface HtmlPreviewFrameProps {
  title: string
  src?: string
  srcDoc?: string
  className?: string
  sandbox?: string
}

export function HtmlPreviewFrame({ title, src, srcDoc, className, sandbox }: HtmlPreviewFrameProps) {
  const resolvedSandbox = sandbox ?? (src ? 'allow-scripts allow-same-origin' : 'allow-scripts')
  const normalizedSrcDoc = useMemo(() => (srcDoc ? normalizeHtmlPreviewDocument(srcDoc) : undefined), [srcDoc])
  return (
    <iframe
      title={title}
      src={src}
      srcDoc={normalizedSrcDoc}
      sandbox={resolvedSandbox}
      referrerPolicy="no-referrer"
      scrolling="yes"
      className={cn('block h-full max-h-full min-h-0 w-full max-w-full border-0 bg-white', className)}
    />
  )
}
