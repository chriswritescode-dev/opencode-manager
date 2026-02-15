import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertCircle, X } from 'lucide-react'

interface GitErrorBannerProps {
  error: { summary: string; detail?: string }
  onDismiss: () => void
}

export function GitErrorBanner({ error, onDismiss }: GitErrorBannerProps) {
  return (
    <Alert variant="destructive" className="mb-0 p-3 sm:p-4 [&>svg]:hidden [&>svg~*]:pl-0">
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <AlertDescription className="flex-1 min-w-0 text-sm">{error.summary}</AlertDescription>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 flex-shrink-0"
            onClick={onDismiss}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        {error.detail && (
          <pre className="p-2 rounded border bg-destructive/5 border-destructive/20 text-xs font-mono overflow-auto max-h-32">
            {error.detail}
          </pre>
        )}
      </div>
    </Alert>
  )
}
