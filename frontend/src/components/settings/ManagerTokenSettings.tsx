import { useState } from 'react'
import { useManagerToken } from '@/hooks/useManagerToken'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { SettingsDisclosure } from './SettingsDisclosure'

interface ManagerTokenSettingsProps {
  isOpen?: boolean
  onToggle?: () => void
}

export function ManagerTokenSettings({ isOpen: controlledOpen, onToggle }: ManagerTokenSettingsProps = {}) {
  const { token, isLoading, rotate } = useManagerToken()
  const [showToken, setShowToken] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true)
  const isOpen = controlledOpen ?? uncontrolledOpen
  const handleToggle = onToggle ?? (() => setUncontrolledOpen((open) => !open))

  const handleRotate = () => {
    if (!confirmRotate) {
      setConfirmRotate(true)
      setTimeout(() => setConfirmRotate(false), 4000)
      return
    }
    rotate.mutate()
    setConfirmRotate(false)
  }

  return (
    <SettingsDisclosure
      title="Manager Internal Token"
      isOpen={isOpen}
      onToggle={handleToggle}
      contentClassName="space-y-3"
      meta={
        <span className="text-xs text-muted-foreground truncate hidden sm:inline">
          Bearer token for workspace plugin and API clients
        </span>
      }
    >
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            id="manager-token"
            type={showToken ? 'text' : 'password'}
            value={isLoading ? 'Loading...' : token ?? ''}
            readOnly
            className="flex-1 font-mono text-xs pr-9"
            autoComplete="new-password"
            name="manager-token-input"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            disabled={!token}
            aria-label={showToken ? 'Hide token' : 'Show token'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <CopyButton
          content={token ?? ''}
          title="Copy"
          className={buttonVariants({ variant: 'outline', size: 'icon' })}
        />
        <Button
          variant={confirmRotate ? 'destructive' : 'outline'}
          size="icon"
          type="button"
          onClick={handleRotate}
          disabled={rotate.isPending || isLoading}
          aria-label="Rotate token"
          title="Rotate token"
        >
          <RefreshCw className={`h-4 w-4 ${rotate.isPending ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {confirmRotate && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Rotating will invalidate the existing token. Any plugin or client using it must be updated. Click Rotate again to confirm.
          </AlertDescription>
        </Alert>
      )}
    </SettingsDisclosure>
  )
}
