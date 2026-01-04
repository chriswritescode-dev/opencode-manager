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
      // Clipboard access denied or not supported
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
        <Check className={cn(sizeClasses, 'text-green-500')} />
      ) : (
        <Copy className={cn(sizeClasses, copied && 'text-green-500')} />
      )}
    </button>
  )
}
