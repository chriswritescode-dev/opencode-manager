import { memo, useMemo, useCallback, useRef, useEffect, Children, isValidElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { markdownComponents } from './MarkdownComponents'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  content: string
  className?: string
  onContentChange?: (newContent: string) => void
}

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

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className = '', onContentChange }: MarkdownRendererProps) {
  const taskItems = useMemo(() => parseTaskItems(content), [content])
  const renderIndexRef = useRef(0)

  useEffect(() => {
    renderIndexRef.current = 0
  }, [content])

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

  const components: Components = {
    ...markdownComponents,
    li(props) {
      const { children, ...rest } = props
      const maybeChecked = (rest as Record<string, unknown>).checked as boolean | null | undefined

      if (maybeChecked !== null && maybeChecked !== undefined) {
        const currentIndex = renderIndexRef.current++
        const taskItem = taskItems[currentIndex]

        if (taskItem) {
          const filteredChildren = Children.toArray(children).filter(
            child => !(isValidElement(child) && child.type === 'input'),
          )

          return (
            <li className="task-list-item flex items-start gap-1.5 my-0.5 md:my-1 list-none">
              <input
                type="checkbox"
                checked={taskItem.checked}
                onChange={() => handleToggle(taskItem)}
                className="mt-[3px] cursor-pointer accent-primary shrink-0"
              />
              <span className="flex-1 min-w-0">{filteredChildren}</span>
            </li>
          )
        }
      }

      return <li className="text-foreground my-0.5 md:my-1" {...rest}>{children}</li>
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
