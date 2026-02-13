import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Copy } from 'lucide-react'
import { oauthApi, type OAuthAuthorizeResponse } from '@/api/oauth'
import { mapOAuthError, OAuthMethod } from '@/lib/oauthErrors'

interface OAuthAuthorizeDialogProps {
  providerId: string
  providerName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (response: OAuthAuthorizeResponse) => void
}

export function OAuthAuthorizeDialog({ 
  providerId, 
  providerName, 
  open, 
  onOpenChange, 
  onSuccess 
}: OAuthAuthorizeDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAuthorize = async (methodIndex: number) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await oauthApi.authorize(providerId, methodIndex)
      onSuccess(response)
    } catch (err) {
      setError(mapOAuthError(err, 'authorize'))
      console.error('OAuth authorize error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect to {providerName}</DialogTitle>
          <DialogDescription>
            Connect your {providerName} account using authorization code.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          <Button
            onClick={() => handleAuthorize(OAuthMethod.CODE)}
            disabled={isLoading}
            className="w-full justify-start"
            variant="outline"
          >
            <Copy className="h-4 w-4 mr-2" />
            {isLoading ? 'Authorizing...' : 'Use Authorization Code'}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          <p>• "Use Authorization Code" will give you a code to manually enter</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
