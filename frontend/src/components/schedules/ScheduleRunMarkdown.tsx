import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from '@/components/file-browser/MarkdownComponents'
import { MarkdownLink } from '@/components/ui/markdown-link'
import { markdownRehypePlugins } from '@/lib/markdownRehypePlugins'

type ScheduleRunMarkdownProps = {
  content: string
  onOpenLocalPath?: (linkPath: string) => void
}

export function ScheduleRunMarkdown({ content, onOpenLocalPath }: ScheduleRunMarkdownProps) {
  const components: Components = {
    ...markdownComponents,
    a(props) {
      return <MarkdownLink {...props} onOpenLocalPath={onOpenLocalPath} />
    },
  }

  return (
    <div className="overflow-hidden">
      <div className="prose prose-invert prose-enhanced max-w-none break-words text-foreground leading-snug">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={markdownRehypePlugins}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
