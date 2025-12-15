import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { useTTSModels, useTTSVoices, useTTSDiscovery } from '@/api/tts'
import { Loader2, Volume2, Square, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Combobox } from '@/components/ui/combobox'
import { DEFAULT_TTS_CONFIG } from '@/api/types/settings'

const TEST_PHRASE = 'Text to speech is working correctly.'

const ttsFormSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().url('Must be a valid URL').min(1, 'Endpoint is required'),
  apiKey: z.string().min(1, 'API key is required when TTS is enabled').or(z.literal('')),
  voice: z.string().min(1, 'Voice is required'),
  model: z.string().min(1, 'Model is required'),
  speed: z.number().min(0.25).max(4.0),
}).refine((data) => {
  if (data.enabled && !data.apiKey) {
    return false
  }
  return true
}, {
  message: 'API key is required when TTS is enabled',
  path: ['apiKey'],
})

type TTSFormValues = z.infer<typeof ttsFormSchema>

export function TTSSettings() {
  const { preferences, isLoading, updateSettings, isUpdating } = useSettings()
  const { speak, stop, isPlaying, isLoading: isTTSLoading, error: ttsError } = useTTS()
  const { refreshModels, refreshVoices, refreshAll } = useTTSDiscovery()
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [isRefreshingDiscovery, setIsRefreshingDiscovery] = useState(false)
  
  const form = useForm<TTSFormValues>({
    resolver: zodResolver(ttsFormSchema),
    defaultValues: DEFAULT_TTS_CONFIG,
  })
  
  const { reset, formState: { isDirty, isValid } } = form
  const watchEnabled = form.watch('enabled')
  const watchApiKey = form.watch('apiKey')
  const watchEndpoint = form.watch('endpoint')
  
  const canTest = watchEnabled && watchApiKey && !isDirty
  
  // Fetch available models and voices when TTS is configured
  const { data: modelsData, isLoading: isLoadingModels, refetch: refetchModels } = useTTSModels(
    preferences?.tts?.enabled && preferences?.tts?.apiKey ? undefined : 'default',
    watchEnabled && !!watchApiKey && !!watchEndpoint
  )
  
  const { data: voicesData, isLoading: isLoadingVoices, refetch: refetchVoices } = useTTSVoices(
    preferences?.tts?.enabled && preferences?.tts?.apiKey ? undefined : 'default',
    watchEnabled && !!watchApiKey && !!watchEndpoint
  )
  
  const availableModels = modelsData?.models || []
  const availableVoices = voicesData?.voices || []
  const modelsCached = modelsData?.cached || false
  const voicesCached = voicesData?.cached || false
  
  const handleRefreshDiscovery = async () => {
    setIsRefreshingDiscovery(true)
    try {
      await refreshAll()
      await Promise.all([
        refetchModels(),
        refetchVoices()
      ])
    } finally {
      setIsRefreshingDiscovery(false)
    }
  }
  
  useEffect(() => {
    if (preferences?.tts) {
      reset({
        enabled: preferences.tts.enabled ?? DEFAULT_TTS_CONFIG.enabled,
        endpoint: preferences.tts.endpoint ?? DEFAULT_TTS_CONFIG.endpoint,
        apiKey: preferences.tts.apiKey ?? DEFAULT_TTS_CONFIG.apiKey,
        voice: preferences.tts.voice ?? DEFAULT_TTS_CONFIG.voice,
        model: preferences.tts.model ?? DEFAULT_TTS_CONFIG.model,
        speed: preferences.tts.speed ?? DEFAULT_TTS_CONFIG.speed,
      })
    }
  }, [preferences?.tts, reset])
  
  const onSubmit = (data: TTSFormValues) => {
    updateSettings({ tts: data })
  }
  
  const handleTest = async () => {
    setTestStatus('idle')
    try {
      await speak(TEST_PHRASE)
      setTestStatus('success')
      setTimeout(() => setTestStatus('idle'), 3000)
    } catch {
      setTestStatus('error')
    }
  }
  
  const handleStopTest = () => {
    stop()
    setTestStatus('idle')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Text-to-Speech</h2>
        <Button 
          onClick={form.handleSubmit(onSubmit)}
          disabled={!isDirty || !isValid || isUpdating}
          size="sm"
        >
          {isUpdating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            'Save'
          )}
        </Button>
      </div>
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Enable TTS</FormLabel>
                  <FormDescription>
                    Allow text-to-speech playback for messages
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {watchEnabled && (
            <>
              <FormField
                control={form.control}
                name="endpoint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>TTS Endpoint</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://api.openai.com/v1/audio/speech"
                        className="bg-background"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      OpenAI-compatible TTS API endpoint
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="sk-..."
                        className="bg-background"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      API key for the TTS service
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

<FormField
                control={form.control}
                name="voice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Voice</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        onChange={field.onChange}
                        options={availableVoices.map(voice => ({
                          value: voice,
                          label: voice
                        }))}
                        placeholder="Select a voice or type custom name..."
                        disabled={!watchEnabled || isLoadingVoices}
                        allowCustomValue={true}
                      />
                    </FormControl>
                    <FormDescription>
                      {isLoadingVoices ? 'Loading available voices...' : 
                       voicesCached ? `Available voices (${availableVoices.length}) - cached` :
                       `Available voices (${availableVoices.length})`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        onChange={field.onChange}
                        options={availableModels.map(model => ({
                          value: model,
                          label: model
                        }))}
                        placeholder="Select a model or type custom name..."
                        disabled={!watchEnabled || isLoadingModels}
                        allowCustomValue={true}
                      />
                    </FormControl>
                    <FormDescription>
                      {isLoadingModels ? 'Loading available models...' : 
                       modelsCached ? `Available models (${availableModels.length}) - cached` :
                       `Available models (${availableModels.length})`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="speed"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between">
                      <FormLabel>Speed</FormLabel>
                      <span className="text-sm text-muted-foreground">
                        {field.value.toFixed(2)}x
                      </span>
                    </div>
                    <FormControl>
                      <Slider
                        min={0.25}
                        max={4.0}
                        step={0.25}
                        value={[field.value]}
                        onValueChange={([value]) => field.onChange(value)}
                        className="w-full"
                      />
                    </FormControl>
                    <FormDescription>
                      Playback speed (0.25x to 4.0x)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <div className="text-base font-medium">Refresh Discovery Data</div>
                  <p className="text-sm text-muted-foreground">
                    Force refresh available models and voices from the endpoint
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshDiscovery}
                  disabled={!watchEnabled || !watchApiKey || isRefreshingDiscovery}
                >
                  {isRefreshingDiscovery ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh
                    </>
                  )}
                </Button>
              </div>

              <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <div className="text-base font-medium">Test TTS</div>
                  <p className="text-sm text-muted-foreground">
                    {isDirty 
                      ? 'Save changes before testing' 
                      : 'Verify your TTS configuration works'}
                  </p>
                  {ttsError && (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <XCircle className="h-4 w-4" />
                      {ttsError}
                    </p>
                  )}
                  {testStatus === 'success' && (
                    <p className="text-sm text-green-500 flex items-center gap-1">
                      <CheckCircle className="h-4 w-4" />
                      TTS is working
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={isPlaying || isTTSLoading ? handleStopTest : handleTest}
                  disabled={!canTest}
                >
                  {isTTSLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Testing...
                    </>
                  ) : isPlaying ? (
                    <>
                      <Square className="h-4 w-4 mr-2" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-4 w-4 mr-2" />
                      Test
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </form>
      </Form>
    </div>
  )
}
