import { useState } from 'react'
import { useOpenCodeServerAuth } from '@/hooks/useOpenCodeServerAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, EyeOff, XCircle } from 'lucide-react'

export function OpenCodeServerAuthSettings() {
  const { status, setPassword, clearPassword } = useOpenCodeServerAuth()
  const [password, setPasswordValue] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isOpen, setIsOpen] = useState(true)

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
        onClick={() => setIsOpen(!isOpen)}
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
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Status:</span>
              <span className="flex items-center gap-2 font-medium">
                {getStatusIcon()}
                {getStatusText()}
              </span>
            </div>

            {status?.source === 'none' && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  If you set OPENCODE_HOST=0.0.0.0 in Docker without a password, the server will refuse to start.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">Password (min 8 characters)</Label>
              <div className="flex gap-2">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  placeholder="Enter new password"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSave}
                  disabled={password.length < 8 || setPassword.isPending}
                >
                  {setPassword.isPending ? 'Saving...' : 'Save'}
                </Button>
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
          </div>
        </div>
      )}
    </div>
  )
}
