import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  content: string
  title?: string
  className?: string
  iconSize?: 'sm' | 'md'
  variant?: 'default' | 'ghost'
}

export function CopyButton({ 
  content, 
  title = 'Copy', 
  className = '', 
  iconSize = 'md',
  variant = 'default'
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!content.trim()) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = content
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        const successful = document.execCommand('copy')
        if (successful) {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }
      } finally {
        document.body.removeChild(textArea)
      }
    }
  }

  if (!content.trim()) {
    return null
  }

  const sizeClasses = iconSize === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const variantClasses = variant === 'ghost' 
    ? 'p-1 hover:bg-accent rounded'
    : 'p-1.5 rounded bg-card hover:bg-card-hover text-muted-foreground hover:text-foreground'

  return (
    <button
      onClick={handleCopy}
      className={cn(variantClasses, className)}
      title={copied ? 'Copied!' : title}
    >
      {copied ? (
        <Check className={cn(sizeClasses, 'text-success')} />
      ) : (
        <Copy className={cn(sizeClasses, copied && 'text-success')} />
      )}
    </button>
  )
}
