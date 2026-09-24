import { useState, useMemo, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'
import {
  oauthApi,
  type OAuthAuthorizeResponse,
  type PromptAnswer,
  type PromptAnswerValue,
  type ProviderAuthMethod,
} from '@/api/oauth'
import { buildAnswer, defaultAnswer, hasFields, hasMissingAnswers, setAnswerValue, visibleFields } from '@/lib/oauthFields'
import { mapOAuthError } from '@/lib/oauthErrors'
import { ProviderAuthField } from './ProviderAuthField'

interface OAuthAuthorizeDialogProps {
  providerId: string
  providerName: string
  methods: ProviderAuthMethod[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (response: OAuthAuthorizeResponse, methodID: string) => void
}

function isBrowserLocalMethod(method: ProviderAuthMethod): boolean {
  return method.label.toLowerCase().includes('browser')
}

export function OAuthAuthorizeDialog({
  providerId,
  providerName,
  methods,
  open,
  onOpenChange,
  onSuccess,
}: OAuthAuthorizeDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMethodID, setSelectedMethodID] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, PromptAnswer>>({})
  const [autoStarted, setAutoStarted] = useState(false)

  const oauthMethods = useMemo(() => {
    return methods
      .filter((method) => method.type === 'oauth')
      .filter((method) => !(providerId === 'openai' && isBrowserLocalMethod(method)))
  }, [methods, providerId])

  const getAnswer = useCallback(
    (method: ProviderAuthMethod) => ({ ...defaultAnswer(method), ...answers[method.id] }),
    [answers],
  )

  const handleAnswerChange = useCallback((methodID: string, key: string, value: PromptAnswerValue | undefined) => {
    setAnswers((prev) => setAnswerValue(prev, methodID, key, value))
  }, [])

  const handleAuthorize = useCallback(async (method: ProviderAuthMethod) => {
    const answer = getAnswer(method)
    const fields = visibleFields(method, answer)

    if (hasMissingAnswers(method, answer)) {
      setError('Please complete all required authentication fields')
      setSelectedMethodID(method.id)
      return
    }

    setIsLoading(true)
    setError(null)
    setSelectedMethodID(method.id)

    try {
      const response = await oauthApi.authorize(
        providerId,
        method.id,
        fields.length > 0 ? buildAnswer(method, answer) : undefined,
      )
      onSuccess(response, method.id)
    } catch (err) {
      setError(mapOAuthError(err, 'authorize'))
    } finally {
      setIsLoading(false)
    }
  }, [getAnswer, providerId, onSuccess])

  useEffect(() => {
    if (open && oauthMethods.length === 1 && !autoStarted && !isLoading) {
      const method = oauthMethods[0]
      setAutoStarted(true)
      setSelectedMethodID(method.id)
      if (!hasFields(method)) {
        void handleAuthorize(method)
      }
    }
  }, [open, oauthMethods, autoStarted, isLoading, handleAuthorize])

  const handleMethodSelection = (method: ProviderAuthMethod) => {
    setError(null)
    setSelectedMethodID(method.id)

    if (!hasFields(method)) {
      void handleAuthorize(method)
    }
  }

  const handleClose = () => {
    setError(null)
    setAnswers({})
    setSelectedMethodID(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border w-full sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect to {providerName}</DialogTitle>
          <DialogDescription>
            Select an authentication method to connect your {providerName} account.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          {oauthMethods.map((method) => {
            const isBrowserLocal = isBrowserLocalMethod(method)
            const answer = getAnswer(method)
            const fields = visibleFields(method, answer)
            const canSubmit = !hasMissingAnswers(method, answer)

            return (
              <div key={method.id} className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <Button
                    onClick={() => handleMethodSelection(method)}
                    disabled={isLoading}
                    className="flex-1 justify-start min-w-0"
                    variant={selectedMethodID === method.id ? 'default' : 'outline'}
                  >
                    <ExternalLink className="h-4 w-4 mr-2 shrink-0" />
                    <span className="truncate">
                      {isLoading && selectedMethodID === method.id ? 'Authorizing...' : method.label}
                    </span>
                  </Button>
                  {isBrowserLocal && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      Localhost only
                    </Badge>
                  )}
                </div>

                {selectedMethodID === method.id && hasFields(method) && (
                  <div className="space-y-3 pl-4 sm:pl-10 pr-1 py-2">
                    {fields.map((field) => (
                      <ProviderAuthField
                        key={field.key}
                        field={field}
                        value={answer[field.key]}
                        disabled={isLoading}
                        onChange={(value) => handleAnswerChange(method.id, field.key, value)}
                      />
                    ))}

                    <Button
                      onClick={() => void handleAuthorize(method)}
                      disabled={isLoading || !canSubmit}
                      className="w-full"
                    >
                      {isLoading && selectedMethodID === method.id ? 'Authorizing...' : 'Continue'}
                    </Button>
                  </div>
                )}

                {isBrowserLocal && (
                  <p className="text-xs text-muted-foreground pl-1 break-words">
                    This method relies on a callback server started by OpenCode and may not work when OCM is remote.
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <div className="text-xs text-muted-foreground">
          <p>• Some methods may require completing authorization in your browser</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
