import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertCircle, X } from 'lucide-react'

export interface ErrorBannerProps {
  title?: string
  summary: string
  detail?: string
  onDismiss?: () => void
  className?: string
}

export function ErrorBanner({ title, summary, detail, onDismiss, className }: ErrorBannerProps) {
  return (
    <Alert variant="destructive" className={className}>
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            {title && (
              <AlertTitle className="mb-1 font-medium leading-none tracking-tight">{title}</AlertTitle>
            )}
            <AlertDescription className="text-sm">{summary}</AlertDescription>
          </div>
          {onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 flex-shrink-0"
              onClick={onDismiss}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        {detail && (
          <pre className="p-2 rounded border bg-destructive/5 border-destructive/20 text-xs font-mono overflow-auto max-h-32">
            {detail}
          </pre>
        )}
      </div>
    </Alert>
  )
}