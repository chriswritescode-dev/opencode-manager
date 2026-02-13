import { useState, useEffect, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ExternalLink, Key, XCircle, ChevronDown, ChevronUp, CheckCircle } from 'lucide-react'
import type { McpAuthStartResponse } from '@/api/mcp'
import { mcpApi } from '@/api/mcp'

interface McpOAuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverName: string
  onStartAuth: () => Promise<McpAuthStartResponse>
  onCompleteAuth: (code: string) => Promise<void>
  onCheckStatus?: () => Promise<boolean>
  onSuccess?: () => void
  directory?: string
}

type Step = 'loading' | 'ready' | 'waiting' | 'popup_closed' | 'success' | 'error'

export function McpOAuthDialog({ 
  open, 
  onOpenChange, 
  serverName,
  onStartAuth,
  onCompleteAuth,
  onCheckStatus,
  onSuccess,
  directory
}: McpOAuthDialogProps) {
  const [step, setStep] = useState<Step>('loading')
  const [loading, setLoading] = useState(false)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showManualEntry, setShowManualEntry] = useState(false)
  const flowIdRef = useRef<string | null>(null)
  const flowPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const popupPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const popupRef = useRef<Window | null>(null)
  const doneRef = useRef(false)

  const scopes = directory ? 'this location' : 'globally'

  const stopAllPolling = useCallback(() => {
    if (flowPollingRef.current) {
      clearInterval(flowPollingRef.current)
      flowPollingRef.current = null
    }
    if (statusPollingRef.current) {
      clearInterval(statusPollingRef.current)
      statusPollingRef.current = null
    }
    if (popupPollingRef.current) {
      clearInterval(popupPollingRef.current)
      popupPollingRef.current = null
    }
  }, [])

  const handleSuccess = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    stopAllPolling()
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    setStep('success')
    onSuccess?.()
    setTimeout(() => {
      onOpenChange(false)
    }, 1500)
  }, [stopAllPolling, onOpenChange, onSuccess])

  const resetState = useCallback(() => {
    setStep('loading')
    setAuthUrl(null)
    setAuthCode('')
    setError(null)
    setLoading(false)
    setShowManualEntry(false)
    stopAllPolling()
    doneRef.current = false
    flowIdRef.current = null
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    popupRef.current = null
  }, [stopAllPolling])

  const startFlowPolling = useCallback(() => {
    if (flowPollingRef.current) return

    flowPollingRef.current = setInterval(async () => {
      if (doneRef.current || !flowIdRef.current) return
      try {
        const result = await mcpApi.checkFlowStatus(flowIdRef.current)
        if (result.status === 'completed') {
          handleSuccess()
        } else if (result.status === 'failed') {
          stopAllPolling()
          setError('error' in result ? result.error : 'Authentication failed')
          setStep('error')
        }
      } catch {
        // ignore
      }
    }, 1500)
  }, [handleSuccess, stopAllPolling])

  const startStatusPolling = useCallback(() => {
    if (!onCheckStatus || statusPollingRef.current) return

    statusPollingRef.current = setInterval(async () => {
      if (doneRef.current) return
      try {
        const isConnected = await onCheckStatus()
        if (isConnected) {
          handleSuccess()
        }
      } catch {
        // ignore
      }
    }, 2000)
  }, [onCheckStatus, handleSuccess])

  const startPopupPolling = useCallback(() => {
    if (popupPollingRef.current) return

    popupPollingRef.current = setInterval(() => {
      const popup = popupRef.current
      if (!popup || doneRef.current) return

      if (popup.closed) {
        if (popupPollingRef.current) {
          clearInterval(popupPollingRef.current)
          popupPollingRef.current = null
        }
        if (!doneRef.current) {
          setStep('popup_closed')
          startFlowPolling()
          startStatusPolling()
        }
      }
    }, 500)
  }, [startFlowPolling, startStatusPolling])

  useEffect(() => {
    if (!open) return

    resetState()

    const initAuth = async () => {
      try {
        const result = await onStartAuth()
        setAuthUrl(result.authorizationUrl)
        flowIdRef.current = result.flowId
        setStep('ready')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start authentication')
        setStep('error')
      }
    }

    initAuth()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      stopAllPolling()
      doneRef.current = false
    }
  }, [stopAllPolling])

  const handleOpenAuthPage = () => {
    if (!authUrl) return
    const width = 600
    const height = 700
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2
    popupRef.current = window.open(
      authUrl,
      'mcp-oauth',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`
    )
    setStep('waiting')
    startPopupPolling()
    startFlowPolling()
    startStatusPolling()
  }

  const handleCompleteManualAuth = async () => {
    if (!authCode.trim()) return

    setLoading(true)
    setError(null)
    try {
      await onCompleteAuth(authCode.trim())
      handleSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete authentication')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState()
    }
    onOpenChange(newOpen)
  }

  const handleRetry = async () => {
    setError(null)
    setStep('loading')
    doneRef.current = false
    flowIdRef.current = null
    try {
      const result = await onStartAuth()
      setAuthUrl(result.authorizationUrl)
      flowIdRef.current = result.flowId
      setStep('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start authentication')
      setStep('error')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md h-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 shrink-0" />
            <span className="truncate">Connect {serverName}</span>
          </DialogTitle>
          <DialogDescription>
            Authenticate to use this MCP server {scopes}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 min-w-0">
          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              <AlertDescription className="break-words">{error}</AlertDescription>
            </Alert>
          )}

          {step === 'loading' && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Preparing authentication...</span>
            </div>
          )}

          {step === 'ready' && authUrl && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Click below to open the authorization page. After you approve access, this dialog will update automatically.
              </p>
              <Button
                onClick={handleOpenAuthPage}
                className="w-full"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Authorization Page
              </Button>
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-muted-foreground hover:text-foreground break-all transition-colors"
                onClick={(e) => {
                  e.preventDefault()
                  handleOpenAuthPage()
                }}
              >
                {authUrl}
              </a>
            </div>
          )}

          {step === 'waiting' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                <span className="ml-2 text-sm text-muted-foreground">Waiting for authorization...</span>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Complete the authorization in the popup window. This dialog will update automatically.
              </p>

              {authUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={handleOpenAuthPage}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Re-open authorization popup
                </Button>
              )}

              <ManualCodeEntry
                showManualEntry={showManualEntry}
                setShowManualEntry={setShowManualEntry}
                authCode={authCode}
                setAuthCode={setAuthCode}
                loading={loading}
                onSubmit={handleCompleteManualAuth}
              />
            </div>
          )}

          {step === 'popup_closed' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                <span className="ml-2 text-sm text-muted-foreground">Checking authentication status...</span>
              </div>
              <p className="text-sm text-muted-foreground">
                If authorization was completed, this will update shortly. Otherwise, paste the <code className="text-xs bg-muted px-1 py-0.5 rounded">code</code> parameter from the redirect URL below.
              </p>
              <div className="space-y-2">
                <Label htmlFor="auth-code">Authorization Code</Label>
                <div className="flex gap-2">
                  <Input
                    id="auth-code"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="Paste code here..."
                    disabled={loading}
                    className="text-sm"
                  />
                  <Button
                    onClick={handleCompleteManualAuth}
                    disabled={loading || !authCode.trim()}
                    size="sm"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit'}
                  </Button>
                </div>
              </div>
              {authUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleOpenAuthPage}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              )}
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center justify-center py-6 gap-2">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <p className="text-sm font-medium">Authentication successful</p>
            </div>
          )}

          {step === 'error' && !error && (
            <div className="flex flex-col items-center justify-center py-6 gap-2">
              <XCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">Something went wrong</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {step === 'error' && (
            <Button variant="outline" onClick={handleRetry}>
              Try Again
            </Button>
          )}
          {step !== 'success' && (
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

function ManualCodeEntry({
  showManualEntry,
  setShowManualEntry,
  authCode,
  setAuthCode,
  loading,
  onSubmit,
}: {
  showManualEntry: boolean
  setShowManualEntry: (show: boolean) => void
  authCode: string
  setAuthCode: (code: string) => void
  loading: boolean
  onSubmit: () => void
}) {
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setShowManualEntry(!showManualEntry)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        {showManualEntry ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Paste authorization code manually
      </button>

      {showManualEntry && (
        <div className="space-y-2 mt-3">
          <p className="text-xs text-muted-foreground">
            After authorizing, copy the <code className="bg-muted px-1 py-0.5 rounded">code</code> parameter from the redirect URL in your browser.
          </p>
          <Label htmlFor="auth-code" className="text-xs">Authorization Code</Label>
          <div className="flex gap-2">
            <Input
              id="auth-code"
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              placeholder="Paste code here..."
              disabled={loading}
              className="text-sm"
            />
            <Button
              onClick={onSubmit}
              disabled={loading || !authCode.trim()}
              size="sm"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
