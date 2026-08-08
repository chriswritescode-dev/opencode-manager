import { useState } from 'react'
import { useManagerToken } from '@/hooks/useManagerToken'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, Check, ChevronDown, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'

interface ManagerTokenSettingsProps {
  isOpen?: boolean
  onToggle?: () => void
}

export function ManagerTokenSettings({ isOpen: controlledOpen, onToggle }: ManagerTokenSettingsProps = {}) {
  const { token, isLoading, rotate } = useManagerToken()
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true)
  const isOpen = controlledOpen ?? uncontrolledOpen
  const handleToggle = onToggle ?? (() => setUncontrolledOpen((open) => !open))

  const handleCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable; user can copy manually from the input
    }
  }

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
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-sm font-semibold truncate">Manager Internal Token</h3>
          <span className="text-xs text-muted-foreground truncate hidden sm:inline">
            Bearer token for workspace plugin and API clients
          </span>
        </div>
        <ChevronDown className={`h-4 w-4 transition-transform flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-1 border-t border-border">
          <div className="space-y-4">
            <div className="flex gap-2 items-center pt-2">
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                variant="outline"
                size="icon"
                type="button"
                onClick={handleCopy}
                disabled={!token}
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button
                variant={confirmRotate ? 'destructive' : 'outline'}
                size="icon"
                type="button"
                onClick={handleRotate}
                disabled={rotate.isPending || isLoading}
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
          </div>
        </div>
      )}
    </div>
  )
}
