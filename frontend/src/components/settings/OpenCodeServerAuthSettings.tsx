import { useState } from 'react'
import { useOpenCodeServerAuth } from '@/hooks/useOpenCodeServerAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, EyeOff, XCircle } from 'lucide-react'

interface OpenCodeServerAuthSettingsProps {
  isOpen?: boolean
  onToggle?: () => void
}

export function OpenCodeServerAuthSettings({ isOpen: controlledOpen, onToggle }: OpenCodeServerAuthSettingsProps = {}) {
  const { status, setPassword, clearPassword } = useOpenCodeServerAuth()
  const [password, setPasswordValue] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true)
  const isOpen = controlledOpen ?? uncontrolledOpen
  const handleToggle = onToggle ?? (() => setUncontrolledOpen((open) => !open))

  const handleSave = () => {
    if (password.length >= 8) {
      setPassword.mutate(password)
      setPasswordValue('')
      setShowPassword(false)
    }
  }

  const getStatusText = () => {
    if (!status) return 'Loading...'
    if (status.source === 'db') return 'Set (configured via UI)'
    if (status.source === 'env') return 'Set (configured via env var)'
    return 'Not set'
  }

  const getStatusIcon = () => {
    if (!status) return null
    if (status.source === 'db') return <CheckCircle2 className="h-4 w-4 text-green-500" />
    if (status.source === 'env') return <CheckCircle2 className="h-4 w-4 text-blue-500" />
    return <XCircle className="h-4 w-4 text-red-500" />
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">OpenCode Server Authentication</h3>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            {getStatusIcon()}
            {getStatusText()}
          </span>
        </div>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-1 border-t border-border">
          <div className="space-y-4">
            {status?.source === 'none' && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  If you set OPENCODE_HOST=0.0.0.0 in Docker without a password, the server will refuse to start.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2 items-center pt-2">
              <div className="relative flex-1">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  placeholder="Enter new password"
                  className="pr-9"
                  autoComplete="new-password"
                  name="opencode-server-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                onClick={handleSave}
                disabled={password.length < 8 || setPassword.isPending}
              >
                {setPassword.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
            {password.length > 0 && password.length < 8 && (
              <p className="text-xs text-destructive">Password must be at least 8 characters</p>
            )}
            {status?.source === 'db' && (
              <Button
                variant="outline"
                onClick={() => clearPassword.mutate()}
                disabled={clearPassword.isPending}
              >
                {clearPassword.isPending ? 'Clearing...' : 'Clear stored password'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
