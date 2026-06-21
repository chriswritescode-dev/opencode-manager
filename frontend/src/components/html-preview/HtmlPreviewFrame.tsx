import { cn } from '@/lib/utils'

interface HtmlPreviewFrameProps {
  title: string
  src?: string
  srcDoc?: string
  className?: string
}

export function HtmlPreviewFrame({ title, src, srcDoc, className }: HtmlPreviewFrameProps) {
  const sandbox = src ? 'allow-scripts allow-same-origin' : 'allow-scripts'
  return (
    <iframe
      title={title}
      src={src}
      srcDoc={srcDoc}
      sandbox={sandbox}
      referrerPolicy="no-referrer"
      className={cn('h-full w-full border-0 bg-white', className)}
    />
  )
}
