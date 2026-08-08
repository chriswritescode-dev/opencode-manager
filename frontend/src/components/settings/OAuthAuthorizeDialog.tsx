import { useState, useMemo, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ExternalLink } from 'lucide-react'
import { oauthApi, type OAuthAuthorizeResponse, type ProviderAuthMethod } from '@/api/oauth'
import { mapOAuthError } from '@/lib/oauthErrors'

interface OAuthAuthorizeDialogProps {
  providerId: string
  providerName: string
  methods: ProviderAuthMethod[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (response: OAuthAuthorizeResponse, methodIndex: number) => void
}

type OAuthPrompt = NonNullable<ProviderAuthMethod['prompts']>[number]

function isBrowserLocalMethod(method: ProviderAuthMethod): boolean {
  return method.label.toLowerCase().includes('browser')
}

function getVisiblePrompts(method: ProviderAuthMethod, inputs: Record<string, string>): OAuthPrompt[] {
  const visiblePrompts: OAuthPrompt[] = []
  const activeInputs: Record<string, string> = {}

  for (const prompt of method.prompts ?? []) {
    const isVisible = !('when' in prompt) || !prompt.when || activeInputs[prompt.when.key] === prompt.when.value

    if (!isVisible) {
      continue
    }

    visiblePrompts.push(prompt)

    if (inputs[prompt.key]) {
      activeInputs[prompt.key] = inputs[prompt.key]
    }
  }

  return visiblePrompts
}

function hasPrompts(method: ProviderAuthMethod): boolean {
  return (method.prompts?.length ?? 0) > 0
}

export function OAuthAuthorizeDialog({ 
  providerId, 
  providerName,
  methods,
  open, 
  onOpenChange, 
  onSuccess 
}: OAuthAuthorizeDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMethodIndex, setSelectedMethodIndex] = useState<number | null>(null)
  const [promptInputs, setPromptInputs] = useState<Record<number, Record<string, string>>>({})
  const [autoStarted, setAutoStarted] = useState(false)

  const getMethodInputs = useCallback((methodIndex: number) => promptInputs[methodIndex] || {}, [promptInputs])

  const oauthMethods = useMemo(() => {
    return methods
      .flatMap((method, index) => method.type === 'oauth' ? [{ method, index }] : [])
      .filter(({ method }: { method: ProviderAuthMethod }) => {
        if (providerId === 'openai' && isBrowserLocalMethod(method)) {
          return false
        }
        return true
      })
  }, [methods, providerId])

  const handleAuthorize = useCallback(async (methodIndex: number) => {
    const method = methods[methodIndex]
    const methodInputs = getMethodInputs(methodIndex)
    const visiblePrompts = getVisiblePrompts(method, methodInputs)
    const missingPrompt = visiblePrompts.some((prompt) => !methodInputs[prompt.key]?.trim())

    if (missingPrompt) {
      setError('Please complete all authentication fields')
      setSelectedMethodIndex(methodIndex)
      return
    }

    setIsLoading(true)
    setError(null)
    setSelectedMethodIndex(methodIndex)

    try {
      const inputs = visiblePrompts.length > 0
        ? Object.fromEntries(
            visiblePrompts.map((prompt) => [prompt.key, methodInputs[prompt.key].trim()])
          )
        : undefined
      const response = await oauthApi.authorize(providerId, methodIndex, inputs)
      onSuccess(response, methodIndex)
    } catch (err) {
      setError(mapOAuthError(err, 'authorize'))
    } finally {
      setIsLoading(false)
    }
  }, [methods, providerId, onSuccess, getMethodInputs])

  useEffect(() => {
    if (open && oauthMethods.length === 1 && !autoStarted && !isLoading) {
      const { index } = oauthMethods[0]
      setAutoStarted(true)
      setSelectedMethodIndex(index)
      if (!hasPrompts(methods[index])) {
        void handleAuthorize(index)
      }
    }
  }, [open, oauthMethods, autoStarted, isLoading, methods, handleAuthorize])

  const handleMethodSelection = (methodIndex: number) => {
    setError(null)
    setSelectedMethodIndex(methodIndex)

    if (!hasPrompts(methods[methodIndex])) {
      void handleAuthorize(methodIndex)
    }
  }

  const handlePromptChange = (methodIndex: number, key: string, value: string) => {
    setPromptInputs((prev) => ({
      ...prev,
      [methodIndex]: {
        ...prev[methodIndex],
        [key]: value,
      },
    }))
  }

  const handleClose = () => {
    setError(null)
    setPromptInputs({})
    setSelectedMethodIndex(null)
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
          {oauthMethods.map(({ method, index }) => {
            const isBrowserLocal = isBrowserLocalMethod(method)
            const methodInputs = getMethodInputs(index)
            const visiblePrompts = getVisiblePrompts(method, methodInputs)
            const canSubmitPrompts = visiblePrompts.every((prompt) => methodInputs[prompt.key]?.trim())
            
            return (
              <div key={index} className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <Button
                    onClick={() => handleMethodSelection(index)}
                    disabled={isLoading}
                    className="flex-1 justify-start min-w-0"
                    variant={selectedMethodIndex === index ? 'default' : 'outline'}
                  >
                    <ExternalLink className="h-4 w-4 mr-2 shrink-0" />
                    <span className="truncate">{isLoading && selectedMethodIndex === index ? 'Authorizing...' : method.label}</span>
                  </Button>
                  {isBrowserLocal && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      Localhost only
                    </Badge>
                  )}
                </div>

                {selectedMethodIndex === index && hasPrompts(method) && (
                  <div className="space-y-3 pl-4 sm:pl-10 pr-1 py-2">
                    {visiblePrompts.map((prompt) => (
                      prompt.type === 'text' ? (
                        <div key={prompt.key} className="space-y-2">
                          <Label htmlFor={prompt.key}>{prompt.message}</Label>
                          <Input
                            id={prompt.key}
                            value={methodInputs[prompt.key] || ''}
                            onChange={(e) => handlePromptChange(index, prompt.key, e.target.value)}
                            placeholder={prompt.placeholder}
                            className="bg-background border-border"
                            disabled={isLoading}
                          />
                        </div>
                      ) : (
                        <div key={prompt.key} className="space-y-2">
                          <Label>{prompt.message}</Label>
                          <Select
                            value={methodInputs[prompt.key] || ''}
                            onValueChange={(value) => handlePromptChange(index, prompt.key, value)}
                            disabled={isLoading}
                          >
                            <SelectTrigger className="bg-background border-border">
                              <SelectValue placeholder="Select an option" />
                            </SelectTrigger>
                            <SelectContent>
                              {prompt.options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )
                    ))}

                    <Button
                      onClick={() => void handleAuthorize(index)}
                      disabled={isLoading || !canSubmitPrompts}
                      className="w-full"
                    >
                      {isLoading && selectedMethodIndex === index ? 'Authorizing...' : 'Continue'}
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
