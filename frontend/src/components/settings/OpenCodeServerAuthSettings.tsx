import { useState } from 'react'
import { useOpenCodeServerAuthSettings } from '@/hooks/useOpenCodeServerAuthSettings'
import { showToast } from '@/lib/toast'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Key } from 'lucide-react'

export function OpenCodeServerAuthSettings() {
  const { settings, isLoading, updateAuthSettingsAsync, isUpdating } = useOpenCodeServerAuthSettings()
  const [password, setPassword] = useState('')

  const handleSave = async () => {
    if (!password.trim()) {
      return
    }

    try {
      const result = await updateAuthSettingsAsync({ password: password.trim() })
      setPassword('')
      
      if (result.serverRestarted) {
        showToast.success('Password updated and OpenCode server restarted')
      } else if (result.restartError) {
        showToast.success('Password updated (restart failed: ' + result.restartError + ')')
      } else {
        showToast.success('Password updated')
      }
    } catch {
      showToast.error('Failed to update password')
    }
  }

  const handleClear = async () => {
    try {
      const result = await updateAuthSettingsAsync({ clearPassword: true })
      
      if (result.serverRestarted) {
        showToast.success('Password cleared and OpenCode server restarted')
      } else if (result.restartError) {
        showToast.success('Password cleared (restart failed: ' + result.restartError + ')')
      } else {
        showToast.success('Password cleared')
      }
    } catch {
      showToast.error('Failed to clear password')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const getPasswordStatusText = () => {
    if (!settings) return 'Loading...'
    
    switch (settings.source) {
      case 'configured':
        return 'Password configured in Web UI'
      case 'env':
        return 'Using environment password'
      case 'none':
        return 'No password configured'
    }
  }

  const showClearButton = settings?.source === 'configured'

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
        <Key className="h-5 w-5" />
        OpenCode Server Authentication
      </h2>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Username</Label>
          <div className="text-sm text-muted-foreground">
            {settings?.username || 'Loading...'}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Password Status</Label>
          <div className="text-sm text-muted-foreground">
            {getPasswordStatusText()}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">New Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to keep current password"
            autoComplete="off"
          />
          <p className="text-sm text-muted-foreground">
            Set a new password for the OpenCode server Basic Auth
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={!password.trim() || isUpdating}
          >
            {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Password
          </Button>
          
          {showClearButton && (
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={isUpdating}
            >
              {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Clear Web UI Password
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
