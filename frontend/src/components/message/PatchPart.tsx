import type { components } from '@/api/opencode-types'
import { getRelativePath } from './FileToolRender'

type PatchPartType = components['schemas']['PatchPart']

interface PatchPartProps {
  part: PatchPartType
  onFileClick?: (filePath: string) => void
}

export function PatchPart({ part, onFileClick }: PatchPartProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden my-2">
      <div className="px-3 py-1.5 bg-card flex items-center justify-between text-sm">
        <span className="font-medium">
          File Changes ({part.files.length} file{part.files.length !== 1 ? 's' : ''})
        </span>
        <span className="text-muted-foreground text-xs font-mono">{part.hash.slice(0, 8)}</span>
      </div>
      
      <div className="bg-card px-3 py-2 space-y-1">
        {part.files.map((file, index) => (
          <div
            key={index}
            className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            onClick={() => onFileClick?.(file)}
          >
            {getRelativePath(file)}
          </div>
        ))}
      </div>
    </div>
  )
}