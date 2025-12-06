import { Copy } from 'lucide-react'

interface CopyButtonProps {
  content: string
  title: string
  className?: string
}

export function CopyButton({ content, title, className = "" }: CopyButtonProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
    } catch (error) {
      console.error('Failed to copy content:', error)
    }
  }

  if (!content.trim()) {
    return null
  }

  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 rounded bg-card hover:bg-card-hover text-muted-foreground hover:text-foreground ${className}`}
      title={title}
    >
      <Copy className="w-4 h-4" />
    </button>
  )
}
