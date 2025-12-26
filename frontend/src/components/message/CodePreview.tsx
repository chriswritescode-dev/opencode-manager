import React from 'react'
import { Copy } from 'lucide-react'
import { useMobile } from '@/hooks/useMobile'
import { cn } from '@/lib/utils'

interface CodePreviewProps {
  fileName: string
  content: string
}

const INITIAL_CODE_LINES = 20

function extractFileFromPath(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()

  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    svg: 'svg',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    sql: 'sql',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    dart: 'dart',
  }

  return langMap[ext || ''] || 'plaintext'
}

export function CodePreview({ fileName, content }: CodePreviewProps) {
  const isMobile = useMobile()
  const [copied, setCopied] = React.useState(false)
  const [showMore, setShowMore] = React.useState(false)

  const language = detectLanguage(fileName)
  const fileExtension = fileName.split('.').pop() || language

  const lines = content.split('\n')
  const totalLines = lines.length
  const isLargeFile = totalLines > INITIAL_CODE_LINES

  const displayedContent = isLargeFile && !showMore
    ? lines.slice(0, INITIAL_CODE_LINES).join('\n')
    : content

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="flex flex-col bg-background">
      <div className="px-3 py-2 bg-muted/30 border-b border-border/50 flex items-center justify-between text-xs">
        <span className="font-medium truncate flex-1">{extractFileFromPath(fileName)}</span>
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-accent rounded flex-shrink-0"
          title={copied ? 'Copied!' : 'Copy'}
        >
          <Copy className={cn('w-3.5 h-3.5', copied && 'text-green-500')} />
        </button>
      </div>

      <div className={cn('overflow-y-auto', isMobile ? 'max-h-64' : 'max-h-96')}>
        <div className="p-4">
          <pre className={cn('text-xs', isMobile && 'whitespace-pre-wrap break-all')}>
            <code className={`language-${fileExtension}`}>
              {displayedContent}
            </code>
          </pre>
        </div>
      </div>

      {isLargeFile && !showMore && (
        <button
          onClick={() => setShowMore(true)}
          className="mx-3 my-2 px-3 py-1.5 bg-muted hover:bg-muted/70 border border-border/50 rounded text-xs text-muted-foreground"
        >
          Show more ({totalLines - INITIAL_CODE_LINES} more lines)
        </button>
      )}

      {isLargeFile && showMore && (
        <button
          onClick={() => setShowMore(false)}
          className="mx-3 my-2 px-3 py-1.5 bg-muted hover:bg-muted/70 border border-border/50 rounded text-xs text-muted-foreground"
        >
          Show less
        </button>
      )}
    </div>
  )
}