import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ExternalLink, CheckCircle } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { showToast } from '@/lib/toast'
import { oauthApi, type OAuthAuthorizeResponse } from '@/api/oauth'
import { mapOAuthError } from '@/lib/oauthErrors'

interface OAuthCallbackDialogProps {
  providerId: string
  providerName: string
  authResponse: OAuthAuthorizeResponse
  methodIndex: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function OAuthCallbackDialog({ 
  providerId, 
  providerName, 
  authResponse,
  methodIndex,
  open, 
  onOpenChange, 
  onSuccess 
}: OAuthCallbackDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleCallback = async () => {
    setIsLoading(true)
    setLoadingMessage('Completing authentication...')
    setError(null)

    try {
      setLoadingMessage('Restarting server with new credentials...')
      await oauthApi.callback(
        providerId, 
        authResponse.method === 'code' 
          ? { method: methodIndex, code: authCode.trim() }
          : { method: methodIndex }
      )
      onSuccess()
    } catch (err) {
      setError(mapOAuthError(err, 'callback'))
      console.error('OAuth callback error:', err)
    } finally {
      setIsLoading(false)
      setLoadingMessage('')
    }
  }

  const handleOpenAuthUrl = () => {
    window.open(authResponse.url, '_blank')
  }

  const handleClose = () => {
    setError(null)
    setAuthCode('')
    onOpenChange(false)
  }

  const isAutoMethod = authResponse.method === 'auto'

  // Extract device/user code from instructions (e.g., "Enter code: 596A-E304")
  const codeMatch = authResponse.instructions.match(/(?:Enter code|User code|Device code)[:\s]+([A-Z0-9-]+)/i)
  const deviceCode = codeMatch ? codeMatch[1] : ''

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>Complete {providerName} Authentication</DialogTitle>
          <DialogDescription>
            {isAutoMethod 
              ? 'Follow the instructions below to complete authentication.'
              : 'Enter the authorization code from the provider.'
            }
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-3">
            <div className="bg-muted p-3 rounded-md">
              <p className="text-sm mb-2">{authResponse.instructions}</p>
              
              {deviceCode && (
                <div className="flex items-center gap-2 mb-3">
                  <code className="flex-1 bg-background px-3 py-2 rounded text-sm font-mono">
                    {deviceCode}
                  </code>
                  <CopyButton
                    content={deviceCode}
                    title="Copy device code"
                    variant="ghost"
                    iconSize="sm"
                    className="flex-shrink-0"
                    onCopy={() => showToast.success('Code copied to clipboard')}
                  />
                </div>
              )}
              
              <div className="flex gap-2">
                <Button
                  onClick={handleOpenAuthUrl}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Authorization Page
                </Button>
                <CopyButton
                  content={authResponse.url}
                  title="Copy authorization URL"
                  variant="ghost"
                  iconSize="sm"
                  className="flex-shrink-0"
                  onCopy={() => showToast.success('URL copied to clipboard')}
                />
              </div>
            </div>

            {!isAutoMethod && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="authCode">Authorization Code</Label>
                  <CopyButton
                    content={authCode}
                    title="Copy authorization code"
                    variant="ghost"
                    iconSize="sm"
                    className="flex-shrink-0"
                    onCopy={() => showToast.success('Code copied to clipboard')}
                  />
                </div>
                <Input
                  id="authCode"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder="Enter the authorization code..."
                  className="bg-background border-border"
                  disabled={isLoading}
                />
              </div>
            )}

            <Button
              onClick={handleCallback}
              className="w-full"
              disabled={isLoading || (!isAutoMethod && !authCode.trim())}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {loadingMessage || 'Completing...'}
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Complete Authentication
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
