import { getFilePreviewUrl } from '@/api/files'
import {
  FullscreenSheet,
  FullscreenSheetHeader,
  FullscreenSheetContent,
} from '@/components/ui/fullscreen-sheet'
import { Button } from '@/components/ui/button'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { HtmlPreviewFrame } from './HtmlPreviewFrame'
import type { HtmlArtifact } from '@/lib/htmlArtifacts'

interface HtmlArtifactPanelProps {
  artifact: HtmlArtifact | null
  isFullscreen: boolean
  isMobile: boolean
  onClose: () => void
  onToggleFullscreen: () => void
}

export function HtmlArtifactPanel({
  artifact,
  isFullscreen,
  isMobile,
  onClose,
  onToggleFullscreen,
}: HtmlArtifactPanelProps) {
  if (!artifact) return null

  const previewSrc = artifact.source === 'file' && artifact.path
    ? getFilePreviewUrl(artifact.path)
    : undefined
  const previewSrcDoc = artifact.source === 'inline' ? artifact.html : undefined
  const title = artifact.title
  const sourceLabel = artifact.source === 'file' ? 'File artifact' : 'Inline artifact'

  const header = (
    <div className="flex items-center justify-between px-4 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">{title}</span>
        <span className="text-xs text-muted-foreground shrink-0">({sourceLabel})</span>
      </div>
      <div className="flex items-center gap-1">
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )

  const frame = (
    <HtmlPreviewFrame
      title={title}
      src={previewSrc}
      srcDoc={previewSrcDoc}
    />
  )

  if (isMobile || isFullscreen) {
    return (
      <FullscreenSheet>
        <FullscreenSheetHeader>
          {header}
        </FullscreenSheetHeader>
        <FullscreenSheetContent>
          {frame}
        </FullscreenSheetContent>
      </FullscreenSheet>
    )
  }

  return (
    <div className="hidden md:flex w-[45%] max-w-[720px] min-w-[360px] border-l border-border bg-background flex-col">
      <div className="flex-shrink-0 border-b border-border">
        {header}
      </div>
      <div className="flex-1 min-h-0">
        {frame}
      </div>
    </div>
  )
}
