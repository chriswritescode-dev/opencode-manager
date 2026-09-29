import { memo, useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { markdownComponents } from './MarkdownComponents'
import { resolveLinkedFilePath } from './resolve-link-path'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  content: string
  className?: string
  onContentChange?: (newContent: string) => void
  filePath?: string
  onOpenFile?: (path: string) => void
}

const EXTERNAL_LINK = /^https?:\/\//i

interface TaskItem {
  lineIndex: number
  checked: boolean
}

function parseTaskItems(content: string): TaskItem[] {
  const items: TaskItem[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*[-*+]\s+)\[([ xX])\]/i)
    if (match) {
      items.push({ lineIndex: i, checked: match[2].toLowerCase() === 'x' })
    }
  }
  return items
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className = '', onContentChange, filePath, onOpenFile }: MarkdownRendererProps) {
  const taskItems = useMemo(() => parseTaskItems(content), [content])

  const handleToggle = useCallback((taskItem: TaskItem) => {
    if (!onContentChange) return
    const lines = content.split('\n')
    const line = lines[taskItem.lineIndex]
    const newLine = line.replace(
      /^(\s*[-*+]\s+)\[([ xX])\]/i,
      (_, prefix: string, checked: string) => `${prefix}[${checked.toLowerCase() === 'x' ? ' ' : 'x'}]`,
    )
    if (newLine !== line) {
      lines[taskItem.lineIndex] = newLine
      onContentChange(lines.join('\n'))
    }
  }, [content, onContentChange])

  const handleInputToggle = useCallback((input: HTMLInputElement) => {
    const inputs = Array.from(input.closest('.prose')?.querySelectorAll('input[type="checkbox"]') ?? [])
    const taskItem = taskItems[inputs.indexOf(input)]
    if (taskItem) {
      handleToggle(taskItem)
    }
  }, [handleToggle, taskItems])

  const components: Components = {
    ...markdownComponents,
    input(props) {
      const { type, checked, disabled, ...rest } = props
      delete (rest as Record<string, unknown>).node

      if (type === 'checkbox') {
        return (
          <input
            type="checkbox"
            checked={Boolean(checked)}
            onChange={(event) => handleInputToggle(event.currentTarget)}
            className="cursor-pointer accent-primary"
            {...rest}
          />
        )
      }

      return <input type={type} checked={checked} disabled={disabled} {...rest} />
    },
    a(props) {
      const { href, children, ...rest } = props
      delete (rest as Record<string, unknown>).node

      const linkedPath = href && filePath && onOpenFile ? resolveLinkedFilePath(filePath, href) : null
      if (linkedPath && onOpenFile) {
        return (
          <a
            href={href}
            {...rest}
            onClick={(event) => {
              event.preventDefault()
              onOpenFile(linkedPath)
            }}
          >
            {children}
          </a>
        )
      }

      if (href && EXTERNAL_LINK.test(href)) {
        return <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>
      }

      return <a href={href} {...rest}>{children}</a>
    },
  }

  return (
    <div className={`pb-[200px] p-4 prose prose-invert prose-enhanced max-w-none text-foreground overflow-hidden break-words leading-snug ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
