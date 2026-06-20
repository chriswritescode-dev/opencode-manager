import { cn } from '@/lib/utils'

interface HtmlPreviewFrameProps {
  title: string
  src?: string
  srcDoc?: string
  className?: string
}

export function HtmlPreviewFrame({ title, src, srcDoc, className }: HtmlPreviewFrameProps) {
  return (
    <iframe
      title={title}
      src={src}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={cn('h-full w-full border-0 bg-white', className)}
    />
  )
}
