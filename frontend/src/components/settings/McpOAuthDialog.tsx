import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ExternalLink, Key, XCircle } from 'lucide-react'
import type { McpAuthStartResponse } from '@/api/mcp'

interface McpOAuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverName: string
  onAutoAuth: () => Promise<void>
  onStartAuth: () => Promise<McpAuthStartResponse>
  onCompleteAuth: (code: string) => Promise<void>
  directory?: string
}

export function McpOAuthDialog({ 
  open, 
  onOpenChange, 
  serverName,
  onAutoAuth,
  onStartAuth,
  onCompleteAuth,
  directory
}: McpOAuthDialogProps) {
  const [step, setStep] = useState<'method' | 'auto' | 'manual' | 'enter_code'>('method')
  const [loading, setLoading] = useState(false)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleAutoAuth = async () => {
    setLoading(true)
    setError(null)
    setStep('auto')
    try {
      await onAutoAuth()
      onOpenChange(false)
      resetState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate')
      setStep('method')
    } finally {
      setLoading(false)
    }
  }

  const handleStartManualAuth = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await onStartAuth()
      setAuthUrl(result.authorizationUrl)
      setStep('manual')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start authentication')
    } finally {
      setLoading(false)
    }
  }

  const handleCompleteAuth = async () => {
    if (!authCode.trim()) return
    
    setLoading(true)
    setError(null)
    try {
      await onCompleteAuth(authCode.trim())
      onOpenChange(false)
      resetState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete authentication')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenAuthUrl = () => {
    if (authUrl) {
      window.open(authUrl, '_blank')
      setStep('enter_code')
    }
  }

  const resetState = () => {
    setStep('method')
    setAuthUrl(null)
    setAuthCode('')
    setError(null)
    setLoading(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState()
    }
    onOpenChange(newOpen)
  }

  const scopes = directory ? 'this location' : 'global'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md z-[200]" overlayClassName="z-[200]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Connect {serverName}
          </DialogTitle>
          <DialogDescription>
            Authenticate to use this MCP server for {scopes}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === 'method' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Choose an authentication method:</p>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleAutoAuth}
                  disabled={loading}
                  variant="outline"
                  className="justify-start h-auto py-3"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Starting authentication...
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-4 w-4 mr-2" />
                      <div className="text-left">
                        <div className="font-medium">Auto (Recommended)</div>
                        <div className="text-xs text-muted-foreground">
                          Opens browser, handles redirect automatically
                        </div>
                      </div>
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleStartManualAuth}
                  disabled={loading}
                  variant="outline"
                  className="justify-start h-auto py-3"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Starting authentication...
                    </>
                  ) : (
                    <>
                      <Key className="h-4 w-4 mr-2" />
                      <div className="text-left">
                        <div className="font-medium">Manual with Code</div>
                        <div className="text-xs text-muted-foreground">
                          Open URL, then paste the authorization code
                        </div>
                      </div>
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === 'auto' && (
            <div className="flex items-center justify-center py-8">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Waiting for browser authorization...
                </p>
              </div>
            </div>
          )}

          {step === 'manual' && authUrl && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Open the authorization link in your browser to begin the flow. Then paste the code below.
              </p>
              <Button
                onClick={handleOpenAuthUrl}
                className="w-full"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Auth Page
              </Button>
              <div className="text-xs text-muted-foreground break-all bg-muted p-2 rounded">
                {authUrl}
              </div>
            </div>
          )}

          {step === 'enter_code' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Paste the authorization code from the browser:
              </p>
              <div className="space-y-2">
                <Label htmlFor="auth-code">Authorization Code</Label>
                <Input
                  id="auth-code"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder="Paste code here..."
                  disabled={loading}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'enter_code' && (
            <>
              <Button
                variant="outline"
                onClick={() => setStep('method')}
                disabled={loading}
              >
                Back
              </Button>
              <Button
                onClick={handleCompleteAuth}
                disabled={loading || !authCode.trim()}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  'Complete Authentication'
                )}
              </Button>
            </>
          )}
          {(step === 'method' || step === 'manual') && (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
