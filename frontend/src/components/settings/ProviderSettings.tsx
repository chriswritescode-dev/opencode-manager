import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Loader2, Key, Check, X, Plus } from 'lucide-react'
import { providerCredentialsApi } from '@/api/providers'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AddProviderDialog } from './AddProviderDialog'
import { getProviders } from '@/api/providers'

export function ProviderSettings() {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data: providers, isLoading: providersLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => getProviders(),
    staleTime: 300000,
  })

  const { data: credentialsList, isLoading: credentialsLoading } = useQuery({
    queryKey: ['provider-credentials'],
    queryFn: () => providerCredentialsApi.list(),
  })

  const setCredentialMutation = useMutation({
    mutationFn: ({ providerId, apiKey }: { providerId: string; apiKey: string }) =>
      providerCredentialsApi.set(providerId, apiKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
      setSelectedProvider(null)
      setApiKey('')
    },
  })

  const deleteCredentialMutation = useMutation({
    mutationFn: (providerId: string) => providerCredentialsApi.delete(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
    },
  })

  const handleSetCredential = () => {
    if (selectedProvider && apiKey) {
      setCredentialMutation.mutate({ providerId: selectedProvider, apiKey })
    }
  }

  const handleDeleteCredential = (providerId: string) => {
    if (confirm(`Remove credentials for ${providerId}?`)) {
      deleteCredentialMutation.mutate(providerId)
    }
  }

  const hasCredentials = (providerId: string) => {
    return credentialsList?.includes(providerId) || false
  }

  if (providersLoading || credentialsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Provider Credentials</h2>
          <p className="text-sm text-muted-foreground">
            Manage API keys for AI providers. Keys are stored securely in your workspace.
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Provider
        </Button>
      </div>

      {!providers || providers.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              No providers configured. Add providers in your OpenCode config.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {providers.map((provider) => {
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
                            Configured
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <X className="h-3 w-3 mr-1" />
                            No Key
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {provider.npm && <span className="text-xs">Package: {provider.npm}</span>}
                        {provider.options?.baseURL && (
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
                        onClick={() => setSelectedProvider(provider.id)}
                      >
                        <Key className="h-4 w-4 mr-1" />
                        {hasKey ? 'Update' : 'Add'} Key
                      </Button>
                      {hasKey && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDeleteCredential(provider.id)}
                          disabled={deleteCredentialMutation.isPending}
                        >
                          Remove
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

      <Dialog open={!!selectedProvider} onOpenChange={(open) => !open && setSelectedProvider(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Set API Key for {selectedProvider}</DialogTitle>
            <DialogDescription>
              Enter your API key. It will be stored securely in your workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="bg-background border-border pr-20"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedProvider(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSetCredential}
              disabled={!apiKey || setCredentialMutation.isPending}
            >
              {setCredentialMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddProviderDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  )
}
