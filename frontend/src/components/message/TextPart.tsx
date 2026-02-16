import React, { useEffect, useState, useId, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import mermaid from 'mermaid'
import { Maximize2, X, AlertCircle } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import type { components } from '@/api/opencode-types'
import { useTheme } from '@/hooks/useTheme'
import 'highlight.js/styles/github-dark.css'

type TextPart = components['schemas']['TextPart']

interface TextPartProps {
  part: TextPart
}

interface MermaidBlockProps {
  code: string
}

function MermaidBlock({ code }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const theme = useTheme()
  const uniqueId = useId().replace(/:/g, '-')
  const renderAttempt = React.useRef(0)

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
      flowchart: {
        htmlLabels: false,
      },
    })
  }, [theme])

  const renderDiagram = useCallback(async () => {
    renderAttempt.current += 1
    const currentAttempt = renderAttempt.current
    
    try {
      setError(null)
      const id = `mermaid-${uniqueId}-${currentAttempt}`
      const result = await mermaid.render(id, code.trim())
      if (currentAttempt === renderAttempt.current && result?.svg) {
        setSvg(result.svg)
      }
    } catch (err: unknown) {
      if (currentAttempt === renderAttempt.current) {
        let message = 'Failed to render diagram'
        if (err instanceof Error) {
          message = err.message
        } else if (typeof err === 'string') {
          message = err
        } else if (err && typeof err === 'object' && 'message' in err) {
          message = String((err as { message: unknown }).message)
        }
        setError(message)
        setSvg(null)
      }
    }
  }, [code, uniqueId])

  useEffect(() => {
    renderDiagram()
  }, [renderDiagram, theme])

  if (error) {
    return (
      <div className="relative my-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-500 mb-2">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm font-medium">Mermaid Error</span>
          </div>
          <pre className="text-xs text-red-400 mb-3 whitespace-pre-wrap">{error}</pre>
          <pre className="bg-accent p-3 rounded-lg overflow-x-auto text-sm border border-border">
            <code>{code}</code>
          </pre>
        </div>
        <CopyButton content={code} title="Copy code" className="absolute top-2 right-2" />
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="my-4 p-4 bg-accent rounded-lg border border-border flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      <div className="relative my-4 group">
        <div 
          className="bg-accent p-4 rounded-lg border border-border overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1.5 rounded bg-card hover:bg-card-hover text-muted-foreground hover:text-foreground"
            title="Expand diagram"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <CopyButton content={code} title="Copy code" />
        </div>
      </div>

      {isExpanded && (
        <div 
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsExpanded(false)}
        >
          <div 
            className="relative bg-card border border-border rounded-lg p-6 max-w-[95vw] max-h-[95vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsExpanded(false)}
              className="absolute top-3 right-3 p-2 rounded-lg bg-accent hover:bg-accent/80 text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <div 
              className="mermaid-expanded"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </>
  )
}

interface CodeBlockProps {
  children?: React.ReactNode
  className?: string
  [key: string]: unknown
}

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  const extractTextContent = (node: React.ReactNode): string => {
    if (typeof node === 'string') return node
    if (typeof node === 'number') return node.toString()
    if (Array.isArray(node)) return node.map(extractTextContent).join('')
    if (React.isValidElement(node)) {
      const element = node as React.ReactElement<Record<string, unknown>>
      if (element.props.children) {
        return extractTextContent(element.props.children as React.ReactNode)
      }
    }
    return ''
  }
  
  const codeContent = extractTextContent(children)

  return (
    <div className="relative">
      <pre className={`bg-accent p-1 rounded-lg overflow-x-auto whitespace-pre-wrap break-words border border-border my-4 ${className || ''}`} {...props}>
        {children}
      </pre>
      <CopyButton content={codeContent} title="Copy code" className="absolute top-2 right-2" />
    </div>
  )
}

function isMermaidBlockComplete(text: string): boolean {
  const mermaidPattern = /```mermaid\s*([\s\S]*?)```/g
  let match
  while ((match = mermaidPattern.exec(text)) !== null) {
    if (match[1]) return true
  }
  return false
}

export function TextPart({ part }: TextPartProps) {
  const mermaidComplete = React.useMemo(() => {
    return part.text ? isMermaidBlockComplete(part.text) : false
  }, [part.text])

  if (!part.text || part.text.trim() === '') {
    return null  
  }

  return (
    <div className="prose prose-invert prose-enhanced max-w-none text-foreground overflow-hidden break-words leading-snug">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !className || !className.includes('language-')
            
            if (className?.includes('language-mermaid') && mermaidComplete) {
              const extractText = (n: React.ReactNode): string => {
                if (typeof n === 'string') return n
                if (typeof n === 'number') return n.toString()
                if (Array.isArray(n)) return n.map(extractText).join('')
                if (React.isValidElement(n)) {
                  const el = n as React.ReactElement<{ children?: React.ReactNode }>
                  if (el.props.children) {
                    return extractText(el.props.children)
                  }
                }
                return ''
              }
              const mermaidCode = extractText(children)
              return <MermaidBlock code={mermaidCode} />
            }
            
            if (isInline) {
              return (
                <code className={className || "bg-accent px-1.5 py-0.5 rounded text-sm text-foreground break-all"} {...props}>
                  {children}
                </code>
              )
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
          pre({ children }) {
            return (
              <CodeBlock>
                {children}
              </CodeBlock>
            )
          },
          p({ children }) {
            return <p className="text-foreground my-0.5 md:my-1">{children}</p>
          },
          strong({ children }) {
            return <strong className="font-semibold text-foreground">{children}</strong>
          },
          ul({ children }) {
            return <ul className="list-disc text-foreground my-0.5 md:my-1">{children}</ul>
          },
          ol({ children }) {
            return <ol className="list-decimal text-foreground my-0.5 md:my-1">{children}</ol>
          },
          li({ children }) {
            return <li className="text-foreground my-0.5 md:my-1">{children}</li>
          },
          table({ children }) {
            return (
              <div className="table-wrapper">
                <table>{children}</table>
              </div>
            )
          }
        }}
      >
        {part.text}
      </ReactMarkdown>
    </div>
  )
}
