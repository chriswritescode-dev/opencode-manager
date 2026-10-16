import { memo, useState } from 'react'
import { AppWindow, ExternalLink, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SandboxedHtmlFrame } from '@/components/ui/sandboxed-html-frame'

interface ArtifactPartProps {
  title: string
  src: string
  path?: string
}

/** Renders the sandboxed HTML document produced by an `ocm` `show_artifact` call. */
export const ArtifactPart = memo(function ArtifactPart({ title, src, path }: ArtifactPartProps) {
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="border rounded-lg overflow-hidden my-2 border-border">
      <div className="flex items-center gap-2 bg-card px-4 py-2">
        <AppWindow className="w-4 h-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{title}</span>
          {path && (
            <span className="truncate text-xs text-muted-foreground" title={path}>
              {path}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => setReloadKey((key) => key + 1)}
          aria-label="Reload artifact"
          title="Reload artifact"
        >
          <RotateCw />
        </Button>
        <Button variant="ghost" size="icon-sm" asChild className="shrink-0">
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
            title="Open in new tab"
          >
            <ExternalLink />
          </a>
        </Button>
      </div>
      <SandboxedHtmlFrame src={src} title={title} reloadKey={reloadKey} className="h-[480px]" />
    </div>
  )
})
