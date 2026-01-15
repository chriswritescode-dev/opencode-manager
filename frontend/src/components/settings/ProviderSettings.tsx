import { useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Loader2, Check, X, Shield, ChevronDown, ChevronRight, Key, Search, Pencil, Trash2 } from 'lucide-react'
import { providerCredentialsApi, getProviders } from '@/api/providers'
import type { Provider } from '@/api/providers'
import { oauthApi, type OAuthAuthorizeResponse } from '@/api/oauth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OAuthAuthorizeDialog } from './OAuthAuthorizeDialog'
import { OAuthCallbackDialog } from './OAuthCallbackDialog'
import { ApiKeyDialog } from '@/components/model/ApiKeyDialog'

export function ProviderSettings() {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [oauthDialogOpen, setOauthDialogOpen] = useState(false)
  const [oauthCallbackDialogOpen, setOauthCallbackDialogOpen] = useState(false)
  const [oauthResponse, setOauthResponse] = useState<OAuthAuthorizeResponse | null>(null)
  const [connectedExpanded, setConnectedExpanded] = useState(true)
  const [availableExpanded, setAvailableExpanded] = useState(false)
  const [availableSearch, setAvailableSearch] = useState('')
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)
  const [apiKeyProvider, setApiKeyProvider] = useState<Provider | null>(null)
  const [apiKeyMode, setApiKeyMode] = useState<'add' | 'edit'>('add')
  const queryClient = useQueryClient()

  const { data: providersData, isLoading: providersLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => getProviders(),
    staleTime: 300000,
  })

  const providers = providersData?.providers

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
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      queryClient.invalidateQueries({ queryKey: ['providers-with-models'] })
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

  const hasCredentials = useCallback((providerId: string) => {
    return credentialsList?.includes(providerId) || false
  }, [credentialsList])

  const oauthProviders = useMemo(() => {
    if (!providers || !authMethods) return []
    return providers.filter(provider => supportsOAuth(provider.id))
  }, [providers, authMethods, supportsOAuth])

  const apiKeyProviders = useMemo(() => {
    if (!providers || !authMethods) return { connected: [], available: [] }
    const nonOAuthProviders = providers.filter(provider => !supportsOAuth(provider.id))
    const connected = nonOAuthProviders.filter(provider => hasCredentials(provider.id))
    const available = nonOAuthProviders.filter(provider => !hasCredentials(provider.id))
    return { connected, available }
  }, [providers, authMethods, supportsOAuth, hasCredentials])

  const filteredAvailableProviders = useMemo(() => {
    if (!availableSearch.trim()) return apiKeyProviders.available
    const search = availableSearch.toLowerCase()
    return apiKeyProviders.available.filter(provider => 
      provider.name.toLowerCase().includes(search) || 
      provider.id.toLowerCase().includes(search)
    )
  }, [apiKeyProviders.available, availableSearch])

  const selectedProviderName = useMemo(() => {
    if (!selectedProvider) return ''
    return providers?.find(p => p.id === selectedProvider)?.name || selectedProvider
  }, [selectedProvider, providers])

  const handleAddApiKey = useCallback((provider: Provider) => {
    setApiKeyProvider(provider)
    setApiKeyMode('add')
    setApiKeyDialogOpen(true)
  }, [])

  const handleEditApiKey = useCallback((provider: Provider) => {
    setApiKeyProvider(provider)
    setApiKeyMode('edit')
    setApiKeyDialogOpen(true)
  }, [])

  const handleApiKeySuccess = useCallback(() => {
    setApiKeyDialogOpen(false)
    setApiKeyProvider(null)
    queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
    queryClient.invalidateQueries({ queryKey: ['providers'] })
    queryClient.invalidateQueries({ queryKey: ['providers-with-models'] })
  }, [queryClient])

  const handleApiKeyDialogClose = useCallback((open: boolean) => {
    setApiKeyDialogOpen(open)
    if (!open) {
      setApiKeyProvider(null)
    }
  }, [])

  if (providersLoading || credentialsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-2">OAuth Providers</h2>
          <p className="text-sm text-muted-foreground">
            Connect to AI providers using OAuth authentication.
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
                <CardHeader className="p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        {provider.name || provider.id}
                      </CardTitle>
                      {hasKey ? (
                        <Badge variant="default" className="bg-green-600 hover:bg-green-700 shrink-0">
                          <Check className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="shrink-0">
                          <X className="h-3 w-3 mr-1" />
                          Not Connected
                        </Badge>
                      )}
                    </div>
                    <CardDescription>
                      {modelCount > 0 && (
                        <span className="text-xs">{modelCount} model{modelCount !== 1 ? 's' : ''}</span>
                      )}
                    </CardDescription>
                    <div className="flex flex-wrap gap-2">
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

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-2">API Keys</h2>
          <p className="text-sm text-muted-foreground">
            Manage API keys for AI providers.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setConnectedExpanded(!connectedExpanded)}
            className="flex items-center gap-2 w-full text-left py-2 px-1 hover:bg-accent/50 rounded-md transition-colors"
          >
            {connectedExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-medium text-sm">Connected</span>
            <Badge variant="secondary" className="ml-auto">
              {apiKeyProviders.connected.length}
            </Badge>
          </button>

          {connectedExpanded && (
            <div className="pl-6 space-y-2">
              {apiKeyProviders.connected.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No providers configured. Add an API key below to get started.
                </p>
              ) : (
                apiKeyProviders.connected.map((provider) => {
                  const modelCount = Object.keys(provider.models || {}).length
                  return (
                    <Card key={provider.id} className="bg-card border-border">
                      <CardHeader className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-sm truncate">
                              {provider.name || provider.id}
                            </CardTitle>
                            {modelCount > 0 && (
                              <CardDescription className="text-xs">
                                {modelCount} model{modelCount !== 1 ? 's' : ''}
                              </CardDescription>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="default" className="bg-green-600 hover:bg-green-700 shrink-0 text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              Connected
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditApiKey(provider)}
                              className="h-8 w-8 p-0"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteCredential(provider.id)}
                              disabled={deleteCredentialMutation.isPending}
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  )
                })
              )}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setAvailableExpanded(!availableExpanded)}
            className="flex items-center gap-2 w-full text-left py-2 px-1 hover:bg-accent/50 rounded-md transition-colors"
          >
            {availableExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-medium text-sm">Available Providers</span>
            <Badge variant="secondary" className="ml-auto">
              {apiKeyProviders.available.length}
            </Badge>
          </button>

          {availableExpanded && (
            <div className="pl-6 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search providers..."
                  value={availableSearch}
                  onChange={(e) => setAvailableSearch(e.target.value)}
                  className="pl-9 text-sm"
                />
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredAvailableProviders.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    {availableSearch ? 'No providers match your search.' : 'No available providers.'}
                  </p>
                ) : (
                  filteredAvailableProviders.map((provider) => {
                    const modelCount = Object.keys(provider.models || {}).length
                    return (
                      <Card key={provider.id} className="bg-card border-border">
                        <CardHeader className="p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-sm truncate">
                                {provider.name || provider.id}
                              </CardTitle>
                              {modelCount > 0 && (
                                <CardDescription className="text-xs">
                                  {modelCount} model{modelCount !== 1 ? 's' : ''}
                                </CardDescription>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAddApiKey(provider)}
                            >
                              <Key className="h-3.5 w-3.5 mr-1" />
                              Add Key
                            </Button>
                          </div>
                        </CardHeader>
                      </Card>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {apiKeyProvider && (
        <ApiKeyDialog
          open={apiKeyDialogOpen}
          onOpenChange={handleApiKeyDialogClose}
          provider={{
            id: apiKeyProvider.id,
            name: apiKeyProvider.name,
            api: apiKeyProvider.api,
            env: apiKeyProvider.env || [],
            npm: apiKeyProvider.npm,
            models: Object.entries(apiKeyProvider.models || {}).map(([id, model]) => ({
              id,
              name: model.name || id,
            })),
            source: 'builtin',
            isConnected: hasCredentials(apiKeyProvider.id),
          }}
          onSuccess={handleApiKeySuccess}
          mode={apiKeyMode}
        />
      )}
    </div>
  )
}
