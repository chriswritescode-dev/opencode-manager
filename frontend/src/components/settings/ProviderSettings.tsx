import { useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Check, X, Shield } from 'lucide-react'
import { providerCredentialsApi, getProviders, type Provider } from '@/api/providers'
import { oauthApi, type OAuthAuthorizeResponse } from '@/api/oauth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OAuthAuthorizeDialog } from './OAuthAuthorizeDialog'
import { OAuthCallbackDialog } from './OAuthCallbackDialog'

export function ProviderSettings() {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [oauthDialogOpen, setOauthDialogOpen] = useState(false)
  const [oauthCallbackDialogOpen, setOauthCallbackDialogOpen] = useState(false)
  const [oauthResponse, setOauthResponse] = useState<OAuthAuthorizeResponse | null>(null)
  const queryClient = useQueryClient()

  const { data: providers, isLoading: providersLoading } = useQuery<Provider[]>({
    queryKey: ['providers'],
    queryFn: () => getProviders(),
    staleTime: 300000,
  })

  const { data: credentialsList, isLoading: credentialsLoading } = useQuery({
    queryKey: ['provider-credentials'],
    queryFn: () => providerCredentialsApi.list(),
  })

  const { data: authMethods } = useQuery({
    queryKey: ['provider-auth-methods'],
    queryFn: () => oauthApi.getAuthMethods(),
  })

  const deleteCredentialMutation = useMutation({
    mutationFn: (providerId: string) => providerCredentialsApi.delete(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
    },
  })

  const handleDeleteCredential = (providerId: string) => {
    if (confirm(`Remove credentials for ${providerId}?`)) {
      deleteCredentialMutation.mutate(providerId)
    }
  }

  const handleOAuthAuthorize = (response: OAuthAuthorizeResponse) => {
    setOauthResponse(response)
    setOauthDialogOpen(false)
    setOauthCallbackDialogOpen(true)
  }

  const handleOAuthDialogClose = () => {
    setOauthDialogOpen(false)
    setSelectedProvider(null)
  }

  const handleOAuthSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
    setOauthCallbackDialogOpen(false)
    setOauthResponse(null)
    setSelectedProvider(null)
  }

  const supportsOAuth = useCallback((providerId: string) => {
    const methods = authMethods?.[providerId] || []
    return methods.some(method => method.type === 'oauth')
  }, [authMethods])

  const hasCredentials = (providerId: string) => {
    return credentialsList?.includes(providerId) || false
  }

  const oauthProviders = useMemo(() => {
    if (!providers || !authMethods) return []
    return providers.filter(provider => supportsOAuth(provider.id))
  }, [providers, authMethods, supportsOAuth])

  const selectedProviderName = useMemo(() => {
    if (!selectedProvider) return ''
    return providers?.find(p => p.id === selectedProvider)?.name || selectedProvider
  }, [selectedProvider, providers])

  if (providersLoading || credentialsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-2">OAuth Providers</h2>
        <p className="text-sm text-muted-foreground">
          Connect to AI providers using OAuth. For API keys, configure them in your OpenCode config file.
        </p>
      </div>

      {oauthProviders.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              No OAuth-capable providers available.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {oauthProviders.map((provider) => {
            const hasKey = hasCredentials(provider.id)
            const modelCount = Object.keys(provider.models || {}).length

            return (
              <Card key={provider.id} className="bg-card border-border">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        {provider.name || provider.id}
                        {hasKey ? (
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                            <Check className="h-3 w-3 mr-1" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <X className="h-3 w-3 mr-1" />
                            Not Connected
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {provider.npm ? <span className="text-xs">Package: {provider.npm}</span> : null}
                        {typeof provider.options?.baseURL === 'string' && (
                          <span className="text-xs block">{provider.options.baseURL}</span>
                        )}
                        {modelCount > 0 && (
                          <span className="text-xs block">{modelCount} model{modelCount !== 1 ? 's' : ''}</span>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={hasKey ? 'outline' : 'default'}
                        onClick={() => {
                          setSelectedProvider(provider.id)
                          setOauthDialogOpen(true)
                        }}
                      >
                        <Shield className="h-4 w-4 mr-1" />
                        {hasKey ? 'Reconnect' : 'Connect'}
                      </Button>
                      {hasKey && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDeleteCredential(provider.id)}
                          disabled={deleteCredentialMutation.isPending}
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>
            )
          })}
        </div>
      )}

      {selectedProvider && (
        <OAuthAuthorizeDialog
          providerId={selectedProvider}
          providerName={selectedProviderName}
          open={oauthDialogOpen}
          onOpenChange={handleOAuthDialogClose}
          onSuccess={handleOAuthAuthorize}
        />
      )}

      {selectedProvider && oauthResponse && (
        <OAuthCallbackDialog
          providerId={selectedProvider}
          providerName={selectedProviderName}
          authResponse={oauthResponse}
          open={oauthCallbackDialogOpen}
          onOpenChange={setOauthCallbackDialogOpen}
          onSuccess={handleOAuthSuccess}
        />
      )}
    </div>
  )
}
