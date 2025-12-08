import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ExternalLink, CheckCircle } from 'lucide-react'
import { oauthApi, type OAuthAuthorizeResponse } from '@/api/oauth'
import { mapOAuthError, OAuthMethod } from '@/lib/oauthErrors'

interface OAuthCallbackDialogProps {
  providerId: string
  providerName: string
  authResponse: OAuthAuthorizeResponse
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function OAuthCallbackDialog({ 
  providerId, 
  providerName, 
  authResponse,
  open, 
  onOpenChange, 
  onSuccess 
}: OAuthCallbackDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [authCode, setAuthCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleAutoCallback = async () => {
    setIsLoading(true)
    setError(null)

    try {
      await oauthApi.callback(providerId, { method: OAuthMethod.AUTO })
      onSuccess()
    } catch (err) {
      setError(mapOAuthError(err, 'callback'))
      console.error('OAuth callback error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCodeCallback = async () => {
    if (!authCode.trim()) {
      setError('Please enter the authorization code')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await oauthApi.callback(providerId, { method: OAuthMethod.CODE, code: authCode.trim() })
      onSuccess()
    } catch (err) {
      setError(mapOAuthError(err, 'callback'))
      console.error('OAuth callback error:', err)
    } finally {
      setIsLoading(false)
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>Complete {providerName} Authentication</DialogTitle>
          <DialogDescription>
            {authResponse.method === 'auto' 
              ? 'Follow the instructions to complete authentication.'
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
          {authResponse.method === 'auto' ? (
            <div className="space-y-3">
              <div className="bg-muted p-3 rounded-md">
                <p className="text-sm">{authResponse.instructions}</p>
              </div>
              
              <Button
                onClick={handleOpenAuthUrl}
                className="w-full"
                disabled={isLoading}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Authorization Page
              </Button>

              <Button
                onClick={handleAutoCallback}
                variant="outline"
                className="w-full"
                disabled={isLoading}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {isLoading ? 'Completing...' : 'I Completed Authorization'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-muted p-3 rounded-md">
                <p className="text-sm mb-2">{authResponse.instructions}</p>
                <Button
                  onClick={handleOpenAuthUrl}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Authorization Page
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="authCode">Authorization Code</Label>
                <Input
                  id="authCode"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder="Enter the authorization code..."
                  className="bg-background border-border"
                  disabled={isLoading}
                />
              </div>

              <Button
                onClick={handleCodeCallback}
                className="w-full"
                disabled={isLoading || !authCode.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Completing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Complete Authentication
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
