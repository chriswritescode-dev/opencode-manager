import { cn } from '@/lib/utils'

export function SandboxedHtmlFrame({
  src,
  title,
  reloadKey,
  className,
}: {
  src: string
  title: string
  reloadKey?: string | number
  className?: string
}) {
  return (
    <iframe
      key={reloadKey}
      src={src}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      className={cn('block w-full border-0 bg-white', className)}
    />
  )
}
