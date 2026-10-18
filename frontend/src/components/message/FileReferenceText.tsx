import { useMemo, type ReactNode } from 'react'
import { detectFileReferences } from '@/lib/fileReferences'

interface FileReferenceTextProps {
  text: string
  onFileClick?: (filePath: string) => void
}

export function FileReferenceText({ text, onFileClick }: FileReferenceTextProps) {
  const parts = useMemo(() => {
    const references = detectFileReferences(text)
    if (references.length === 0) return text

    const segments: ReactNode[] = []
    let lastIndex = 0

    references.forEach((ref, index) => {
      if (ref.startIndex > lastIndex) {
        segments.push(text.slice(lastIndex, ref.startIndex))
      }

      segments.push(
        <button
          key={`ref-${index}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onFileClick?.(ref.filePath)
          }}
          className="inline p-0 m-0 bg-transparent border-0 font-[inherit] text-left text-primary hover:text-primary-hover cursor-pointer underline decoration-dotted"
          title={`Click to open ${ref.filePath}`}
          aria-label={`Open ${ref.filePath}`}
        >
          {ref.fullMatch}
        </button>,
      )

      lastIndex = ref.endIndex
    })

    if (lastIndex < text.length) {
      segments.push(text.slice(lastIndex))
    }

    return segments
  }, [text, onFileClick])

  return <>{parts}</>
}
