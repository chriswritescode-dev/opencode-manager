import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuth } from '@/hooks/useAuth'

export function UntrustedOriginBanner() {
  const { config } = useAuth()
  if (config?.originTrusted !== false) return null

  const origin = window.location.origin

  return (
    <Alert className="shrink-0 rounded-none border-x-0 border-t-0 border-warning/40 bg-warning/10">
      <AlertTriangle className="h-4 w-4 text-warning" />
      <AlertDescription>
        This address ({origin}) is not a trusted Manager address. Sign-in, terminals and device pairing may fail. Set MANAGER_PUBLIC_URL to it, or add it to AUTH_TRUSTED_ORIGINS, and restart the Manager.
      </AlertDescription>
    </Alert>
  )
}
