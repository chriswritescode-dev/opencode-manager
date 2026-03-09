import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from '@/components/file-browser/MarkdownComponents'

type ScheduleRunMarkdownProps = {
  content: string
}

export function ScheduleRunMarkdown({ content }: ScheduleRunMarkdownProps) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border/60 bg-background/40">
      <div className="prose prose-invert prose-enhanced max-w-none break-words p-4 text-foreground leading-snug">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight, rehypeRaw]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
