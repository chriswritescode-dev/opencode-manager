import { ExternalLink } from 'lucide-react'
import type { FormExternalField } from '@opencode-manager/shared/opencode'

function safeExternalUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

export function ExternalFieldCard({ field }: { field: FormExternalField }) {
  const href = safeExternalUrl(field.url)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm transition-colors hover:bg-muted/60"
    >
      <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 space-y-0.5">
        <span className="block font-semibold text-foreground">{field.title ?? field.url}</span>
        {field.description && (
          <span className="block text-xs text-muted-foreground">{field.description}</span>
        )}
      </span>
    </a>
  )
}
