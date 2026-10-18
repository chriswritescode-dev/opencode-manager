import type { SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { cn } from '@/lib/utils'
import { InlineImage } from '@/components/ui/inline-image'

type ToolContentEntry = Extract<SessionMessageAssistantTool['state'], { status: 'completed' }>['content'][number]
type ToolFileEntry = Extract<ToolContentEntry, { type: 'file' }>

const IMAGE_URI_PREFIXES = ['data:image/', 'https://', 'http://'] as const

function fileEntries(part: SessionMessageAssistantTool): ToolFileEntry[] {
  if (part.state.status !== 'completed') return []
  return part.state.content.filter((entry): entry is ToolFileEntry => entry.type === 'file')
}

function isRenderableImage(entry: ToolFileEntry): boolean {
  if (!entry.mime.startsWith('image/')) return false
  return IMAGE_URI_PREFIXES.some((prefix) => entry.uri.startsWith(prefix))
}

function fileLabel(entry: ToolFileEntry): string {
  return entry.name || entry.mime
}

export function ToolContentFiles({ part, className }: {
  part: SessionMessageAssistantTool
  className?: string
}) {
  const files = fileEntries(part)
  if (files.length === 0) return null

  return (
    <div className={cn('flex flex-wrap items-start gap-2', className)}>
      {files.map((file, index) => (
        isRenderableImage(file) ? (
          <InlineImage key={index} src={file.uri} alt={fileLabel(file)} className="max-h-60" />
        ) : (
          <span
            key={index}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted border border-border text-sm text-foreground"
          >
            <span className="font-medium break-all">{fileLabel(file)}</span>
          </span>
        )
      ))}
    </div>
  )
}
