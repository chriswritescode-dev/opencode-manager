import { getFilePreviewUrl } from '@/api/files'
import {
  FullscreenSheet,
  FullscreenSheetContent,
} from '@/components/ui/fullscreen-sheet'
import { Button } from '@/components/ui/button'
import { X, Maximize2, Minimize2, RotateCw } from 'lucide-react'
import { useState } from 'react'
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
  const [frameKey, setFrameKey] = useState(0)

  if (!artifact) return null

  const previewSrc = artifact.source === 'file' && artifact.path
    ? getFilePreviewUrl(artifact.path)
    : artifact.source === 'devserver'
      ? artifact.previewUrl
      : undefined
  const previewSrcDoc = artifact.source === 'inline' ? artifact.html : undefined
  const title = artifact.title

  const frameSandbox = artifact.source === 'devserver'
    ? 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'
    : undefined

  const showReload = artifact.source === 'devserver' || artifact.source === 'file'

  const headerButtons = (
    <div className="flex items-center gap-1">
      {showReload && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setFrameKey(k => k + 1)}
          aria-label="Reload preview"
        >
          <RotateCw className="size-4" />
        </Button>
      )}
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
  )

  const frame = (
    <HtmlPreviewFrame
      key={frameKey}
      title={title}
      src={previewSrc}
      srcDoc={previewSrcDoc}
      sandbox={frameSandbox}
    />
  )

  if (isMobile || isFullscreen) {
    return (
      <FullscreenSheet className="h-dvh max-h-dvh w-screen max-w-screen overflow-hidden">
        <FullscreenSheetContent className="relative h-full max-h-full w-full max-w-full">
          <div className="absolute top-2 right-2 z-10">
            {headerButtons}
          </div>
          {frame}
        </FullscreenSheetContent>
      </FullscreenSheet>
    )
  }

  return (
    <div className="hidden md:flex w-[45%] max-w-[720px] min-w-[360px] border-l border-border bg-background flex-col relative">
      <div className="flex-1 min-h-0">
        {frame}
      </div>
      <div className="absolute top-2 right-2 z-10">
        {headerButtons}
      </div>
    </div>
  )
}
