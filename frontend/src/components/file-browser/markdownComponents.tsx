import type { Components } from 'react-markdown'

export const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const isInline = !className || !className.includes('language-')
    if (isInline) {
      return (
        <code className={className || "bg-accent px-1.5 py-0.5 rounded text-sm text-foreground break-all"} {...props}>
          {children}
        </code>
      )
    }
    return <code className={className} {...props}>{children}</code>
  },
  pre({ children }) {
    return (
      <pre className="bg-accent p-1 rounded-lg overflow-x-auto whitespace-pre-wrap break-words border border-border my-4">
        {children}
      </pre>
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
}
