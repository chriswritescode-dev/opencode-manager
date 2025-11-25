import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2, ExternalLink } from 'lucide-react'
import { PROVIDER_TEMPLATES, type ProviderTemplate } from '@/lib/providerTemplates'
import { settingsApi } from '@/api/settings'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface AddProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddProviderDialog({ open, onOpenChange }: AddProviderDialogProps) {
  const [step, setStep] = useState<'select' | 'customize'>('select')
  const [selectedTemplate, setSelectedTemplate] = useState<ProviderTemplate | null>(null)
  const [providerId, setProviderId] = useState('')
  const [providerName, setProviderName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const queryClient = useQueryClient()

  const addProviderMutation = useMutation({
    mutationFn: async () => {
      const config = await settingsApi.getDefaultOpenCodeConfig()
      const currentProvider = config?.content?.provider || {}
      
      const newProvider = {
        npm: selectedTemplate?.npm || '@ai-sdk/openai-compatible',
        name: providerName || selectedTemplate?.name,
        ...(baseURL && {
          options: {
            baseURL,
          },
        }),
        ...(selectedTemplate?.models && {
          models: selectedTemplate.models,
        }),
      }

      const updatedConfig = {
        ...config?.content,
        provider: {
          ...currentProvider,
          [providerId]: newProvider,
        },
      }

      await settingsApi.updateOpenCodeConfig(
        config?.name || 'default',
        { content: updatedConfig }
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
      queryClient.invalidateQueries({ queryKey: ['providers'] })
      handleClose()
    },
  })

  const handleSelectTemplate = (template: ProviderTemplate) => {
    setSelectedTemplate(template)
    setProviderId(template.id)
    setProviderName(template.name)
    setBaseURL(template.options?.baseURL || '')
    setStep('customize')
  }

  const handleAdd = () => {
    if (providerId && selectedTemplate) {
      addProviderMutation.mutate()
    }
  }

  const handleClose = () => {
    setStep('select')
    setSelectedTemplate(null)
    setProviderId('')
    setProviderName('')
    setBaseURL('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] bg-card border-border overflow-y-auto">
        {step === 'select' && (
          <>
            <DialogHeader>
              <DialogTitle>Add Provider</DialogTitle>
              <DialogDescription>
                Choose a provider template to get started quickly
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-4">
              {PROVIDER_TEMPLATES.map((template) => (
                <Card
                  key={template.id}
                  className="cursor-pointer hover:border-blue-500 transition-colors bg-background border-border"
                  onClick={() => handleSelectTemplate(template)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base flex items-center gap-2">
                          {template.name}
                          {!template.requiresApiKey && (
                            <Badge variant="secondary" className="text-xs">
                              Local
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-sm mt-1">
                          {template.description}
                        </CardDescription>
                        <p className="text-xs text-muted-foreground mt-2">
                          {template.npm}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </>
        )}

        {step === 'customize' && selectedTemplate && (
          <>
            <DialogHeader>
              <DialogTitle>Configure {selectedTemplate.name}</DialogTitle>
              <DialogDescription>
                Customize the provider settings before adding
                {selectedTemplate.docsUrl && (
                  <a
                    href={selectedTemplate.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-500 hover:underline ml-2"
                  >
                    View docs <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="providerId">Provider ID</Label>
                <Input
                  id="providerId"
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value)}
                  placeholder="e.g., anthropic, openai, my-provider"
                  className="bg-background border-border"
                />
                <p className="text-xs text-muted-foreground">
                  Unique identifier for this provider (lowercase, no spaces)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="providerName">Display Name</Label>
                <Input
                  id="providerName"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  placeholder={selectedTemplate.name}
                  className="bg-background border-border"
                />
              </div>

              {selectedTemplate.options?.baseURL && (
                <div className="space-y-2">
                  <Label htmlFor="baseURL">Base URL</Label>
                  <Input
                    id="baseURL"
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder={selectedTemplate.options.baseURL}
                    className="bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground">
                    API endpoint for this provider
                  </p>
                </div>
              )}

              <div className="bg-muted p-3 rounded-md">
                <p className="text-xs text-muted-foreground">
                  <strong>NPM Package:</strong> {selectedTemplate.npm}
                </p>
                {selectedTemplate.models && (
                  <p className="text-xs text-muted-foreground mt-1">
                    <strong>Models:</strong> {Object.keys(selectedTemplate.models).length} pre-configured
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('select')}>
                Back
              </Button>
              <Button
                onClick={handleAdd}
                disabled={!providerId || addProviderMutation.isPending}
              >
                {addProviderMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add Provider
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
