import { ErrorBanner } from '@/components/ui/error-banner'

interface GitErrorBannerProps {
  error: { summary: string; detail?: string }
  onDismiss: () => void
}

export function GitErrorBanner({ error, onDismiss }: GitErrorBannerProps) {
  return (
    <ErrorBanner
      summary={error.summary}
      detail={error.detail}
      onDismiss={onDismiss}
      className="mb-0 p-3 sm:p-4 [&>svg]:hidden [&>svg~*]:pl-0"
    />
  )
}