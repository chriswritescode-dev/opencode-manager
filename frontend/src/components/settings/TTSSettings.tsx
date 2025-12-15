import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { useTTSModels, useTTSVoices, useTTSDiscovery } from '@/api/tts'
import { Loader2, Volume2, Square, XCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Combobox } from '@/components/ui/combobox'
import { DEFAULT_TTS_CONFIG } from '@/api/types/settings'

const TEST_PHRASE = 'Text to speech is working correctly.'

const KOKORO_COMPOSITE_VOICE_SUGGESTIONS = [
  { value: "am_adam+am_echo", label: "Composite: am_adam+am_echo" },
  { value: "af_bella+af_nova", label: "Composite: af_bella+af_nova" },
  { value: "bm_daniel+bm_george", label: "Composite: bm_daniel+bm_george" },
]

function isKokoroStyleVoice(voice: string): boolean {
  return /^[a-z]{2}_/.test(voice)
}

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
  const { refreshAll } = useTTSDiscovery()
  const [isRefreshingDiscovery, setIsRefreshingDiscovery] = useState(false)
  
  const form = useForm<TTSFormValues>({
    resolver: zodResolver(ttsFormSchema),
    defaultValues: DEFAULT_TTS_CONFIG,
  })
  
  const { reset, formState: { isDirty, isValid } } = form
  // Fetch available models and voices when TTS is configured
  const { data: modelsData, isLoading: isLoadingModels, refetch: refetchModels } = useTTSModels(
    undefined, // Let the hook use default user
    true // Always fetch if endpoint is available
  )
  
  const { data: voicesData, isLoading: isLoadingVoices, refetch: refetchVoices } = useTTSVoices(
    undefined, // Let the hook use default user
    true // Always fetch if endpoint is available
  )
  
  // Use data from API discovery first, fallback to stored preferences
  const availableModels = modelsData?.models || preferences?.tts?.availableModels || []
  const availableVoices = voicesData?.voices || preferences?.tts?.availableVoices || []
  const modelsCached = modelsData?.cached || false
  const voicesCached = voicesData?.cached || false
  
  const watchEnabled = form.watch('enabled')
  const watchApiKey = form.watch('apiKey')
  const watchEndpoint = form.watch('endpoint')
  const watchVoice = form.watch('voice')
  
  const canTest = watchEnabled && watchApiKey && !isDirty && watchVoice && availableVoices.length > 0
  
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
  
  // Auto-fetch models and voices when endpoint or API key changes
  useEffect(() => {
    if (watchEnabled && watchApiKey && watchEndpoint) {
      const timer = setTimeout(() => {
        refetchModels()
        refetchVoices()
      }, 1000) // Debounce by 1 second to avoid rapid calls
      
      return () => clearTimeout(timer)
    }
  }, [watchEndpoint, watchApiKey, watchEnabled, refetchModels, refetchVoices])
  
  const onSubmit = (data: TTSFormValues) => {
    updateSettings({ tts: data })
  }
  
  const handleTest = () => {
    speak(TEST_PHRASE)
  }
  
  const handleStopTest = () => {
    stop()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="bg-card border-t pt-4">
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
                    <FormLabel>TTS Server URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://api.openai.com"
                        className="bg-background"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Base URL of your TTS service (e.g., https://x.x.x.x:Port)
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
                render={({ field }) => {
                  const hasKokoroVoices = availableVoices.some(isKokoroStyleVoice)
                  const voiceOptions = [
                    ...availableVoices.slice(0, 10).map((voice: string) => ({
                      value: voice,
                      label: voice
                    })),
                    ...(hasKokoroVoices ? KOKORO_COMPOSITE_VOICE_SUGGESTIONS : []),
                    ...availableVoices.slice(10).map((voice: string) => ({
                      value: voice,
                      label: voice
                    }))
                  ]
                  
                  return (
                  <FormItem>
                    <FormLabel>Voice</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        onChange={field.onChange}
                        options={voiceOptions}
                        placeholder={hasKokoroVoices ? "Select a voice or type custom name (e.g., am_adam+am_echo)..." : "Select a voice..."}
                        disabled={!watchEnabled || isLoadingVoices}
                        allowCustomValue={true}
                      />
                    </FormControl>
                    <FormDescription>
                      {isLoadingVoices ? 'Loading available voices...' : 
                       voicesCached ? `Available voices (${availableVoices.length}) - cached` :
                       availableVoices.length > 0 ? `Available voices (${availableVoices.length})${hasKokoroVoices ? ' - Support composite voices (e.g., am_adam+am_echo)' : ''}` :
                       watchEnabled && watchApiKey ? 'No voices available - check endpoint and API key' :
                       'Configure TTS to discover voices'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                  )
                }}
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
                        options={availableModels.map((model: string) => ({
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
                        availableModels.length > 0 ? `Available models (${availableModels.length})` :
                        watchEnabled && watchApiKey ? 'No models available - check endpoint and API key' :
                        'Configure TTS to discover models'}
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
                      {ttsError.includes("not found") && availableVoices.length > 0 && (
                        <span className="text-xs block mt-1">
                          Try selecting from: {availableVoices.slice(0, 5).join(", ")}
                          {availableVoices.length > 5 && ` +${availableVoices.length - 5} more`}
                        </span>
                      )}
                    </p>
                  )}
                  {!ttsError && watchEnabled && watchApiKey && watchEndpoint && availableVoices.length === 0 && !isLoadingVoices && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                       Click "Refresh" to discover available voices, or check your API key and endpoint URL.
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
