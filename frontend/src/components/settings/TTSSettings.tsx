import { useEffect, useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod/v3'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { useTTSModels, useTTSVoices, useTTSDiscovery } from '@/hooks/useTTSDiscovery'
import { getAvailableVoiceNames, isWebSpeechSupported } from '@/lib/webSpeechSynthesizer'
import { Loader2, Volume2, Square, XCircle, RefreshCw, MonitorSpeaker, Globe, CheckCircle2, Cpu, Play, StopCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Combobox } from '@/components/ui/combobox'
import { DEFAULT_TTS_CONFIG } from '@/api/types/settings'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiClient } from '@/api/client'

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
  provider: z.enum(['external', 'builtin', 'chatterbox', 'coqui']),
  endpoint: z.string(),
  apiKey: z.string(),
  voice: z.string(),
  model: z.string(),
  speed: z.number().min(0.25).max(4.0),
  chatterboxExaggeration: z.number().min(0).max(1).optional(),
  chatterboxCfgWeight: z.number().min(0).max(1).optional(),
  autoReadNewMessages: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (!data.enabled) return
  
  if (data.provider === 'external') {
    if (!data.apiKey || data.apiKey.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message: 'API key is required',
      })
    }
    if (!data.endpoint || data.endpoint.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpoint'],
        message: 'Endpoint is required',
      })
    }
  }
  
  if (!data.voice || data.voice.trim().length === 0) {
    if (data.provider === 'builtin') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['voice'],
        message: 'Please select a browser voice',
      })
    }
  }
})

type TTSFormValues = z.infer<typeof ttsFormSchema>

interface ChatterboxStatus {
  running: boolean
  port: number
  host: string
  device: string | null
  cudaAvailable: boolean
  error: string | null
}

interface ChatterboxVoice {
  id: string
  name: string
  description: string
  is_custom?: boolean
}

interface CoquiStatus {
  running: boolean
  port: number
  host: string
  device: string | null
  model: string
  cudaAvailable: boolean
  error: string | null
}

interface CoquiVoice {
  id: string
  name: string
  description: string
}

export function TTSSettings() {
  const { preferences, updateSettings } = useSettings()
  const { speakWithConfig, stop, isPlaying, isLoading: isTTSLoading, error: ttsError } = useTTS()
  const { refreshAll } = useTTSDiscovery()
  const [isRefreshingDiscovery, setIsRefreshingDiscovery] = useState(false)
  const [browserVoices, setBrowserVoices] = useState<string[]>([])
  const [isCheckingBuiltin, setIsCheckingBuiltin] = useState(false)
  
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedDataRef = useRef<TTSFormValues | null>(null)
  
  const form = useForm<TTSFormValues>({
    resolver: zodResolver(ttsFormSchema),
    defaultValues: {
      ...DEFAULT_TTS_CONFIG,
      chatterboxExaggeration: 0.5,
      chatterboxCfgWeight: 0.5,
      autoReadNewMessages: false,
    },
  })
  
  const { reset, formState: { isDirty, isValid }, getValues } = form
  
  const { data: modelsData, isLoading: isLoadingModels, refetch: refetchModels } = useTTSModels(
    undefined,
    true
  )
  
  const { data: voicesData, isLoading: isLoadingVoices, refetch: refetchVoices } = useTTSVoices(
    undefined,
    true
  )
  
  const { data: chatterboxStatus, refetch: refetchChatterboxStatus } = useQuery<ChatterboxStatus>({
    queryKey: ['chatterbox', 'status'],
    queryFn: async () => {
      const response = await apiClient.get('/api/tts/chatterbox/status')
      return response.data
    },
    refetchInterval: 10000,
  })
  
  const { data: chatterboxVoices, refetch: refetchChatterboxVoices } = useQuery<{ voices: string[], voiceDetails: ChatterboxVoice[] }>({
    queryKey: ['chatterbox', 'voices'],
    queryFn: async () => {
      const response = await apiClient.get('/api/tts/chatterbox/voices')
      return response.data
    },
    enabled: chatterboxStatus?.running === true,
  })
  
  const startChatterboxMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/api/tts/chatterbox/start')
      return response.data
    },
    onSuccess: () => {
      refetchChatterboxStatus()
      refetchChatterboxVoices()
    },
  })
  
  const stopChatterboxMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/api/tts/chatterbox/stop')
      return response.data
    },
    onSuccess: () => {
      refetchChatterboxStatus()
    },
  })
  
  const { data: coquiStatus, refetch: refetchCoquiStatus } = useQuery<CoquiStatus>({
    queryKey: ['coqui', 'status'],
    queryFn: async () => {
      const response = await apiClient.get('/api/tts/coqui/status')
      return response.data
    },
    refetchInterval: 10000,
  })
  
  const { data: coquiVoices, refetch: refetchCoquiVoices } = useQuery<{ voices: string[], voiceDetails: CoquiVoice[] }>({
    queryKey: ['coqui', 'voices'],
    queryFn: async () => {
      const response = await apiClient.get('/api/tts/coqui/voices')
      return response.data
    },
    enabled: coquiStatus?.running === true,
  })
  
  const startCoquiMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/api/tts/coqui/start')
      return response.data
    },
    onSuccess: () => {
      refetchCoquiStatus()
      refetchCoquiVoices()
    },
  })
  
  const stopCoquiMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/api/tts/coqui/stop')
      return response.data
    },
    onSuccess: () => {
      refetchCoquiStatus()
    },
  })
  
  const availableModels = modelsData?.models || preferences?.tts?.availableModels || []
  const availableVoices = voicesData?.voices || preferences?.tts?.availableVoices || []
  const modelsCached = modelsData?.cached || false
  const voicesCached = voicesData?.cached || false
  
  const watchEnabled = form.watch('enabled')
  const watchProvider = form.watch('provider')
  const watchApiKey = form.watch('apiKey')
  const watchEndpoint = form.watch('endpoint')
  const watchVoice = form.watch('voice')
  const watchModel = form.watch('model')
  const watchSpeed = form.watch('speed')
  const watchChatterboxExaggeration = form.watch('chatterboxExaggeration')
  const watchChatterboxCfgWeight = form.watch('chatterboxCfgWeight')
  const watchAutoReadNewMessages = form.watch('autoReadNewMessages')
  
  const hasWebSpeechSupport = isWebSpeechSupported()
  
  const canTest = (() => {
    if (!watchEnabled) return false
    
    if (watchProvider === 'builtin') {
      return hasWebSpeechSupport && browserVoices.length > 0 && !!watchVoice && !isCheckingBuiltin
    } else if (watchProvider === 'chatterbox') {
      return chatterboxStatus?.running === true
    } else if (watchProvider === 'coqui') {
      return coquiStatus?.running === true
    } else {
      return !!watchApiKey && !!watchVoice && !isLoadingVoices
    }
  })()
  
  // Load browser voices when provider is builtin
  useEffect(() => {
    if (watchProvider === 'builtin' && watchEnabled) {
      setIsCheckingBuiltin(true)
      getAvailableVoiceNames()
        .then((voices) => {
          setBrowserVoices(voices)
          setIsCheckingBuiltin(false)
        })
        .catch(() => {
          setBrowserVoices([])
          setIsCheckingBuiltin(false)
        })
    }
  }, [watchProvider, watchEnabled])
  
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
  
  const handleCheckBuiltin = async () => {
    setIsCheckingBuiltin(true)
    try {
      const voices = await getAvailableVoiceNames()
      setBrowserVoices(voices)
    } finally {
      setIsCheckingBuiltin(false)
    }
  }
  
  // Load preferences into form
  useEffect(() => {
    if (preferences?.tts) {
      reset({
        enabled: preferences.tts.enabled ?? DEFAULT_TTS_CONFIG.enabled,
        provider: preferences.tts.provider ?? DEFAULT_TTS_CONFIG.provider,
        endpoint: preferences.tts.endpoint ?? DEFAULT_TTS_CONFIG.endpoint,
        apiKey: preferences.tts.apiKey ?? DEFAULT_TTS_CONFIG.apiKey,
        voice: preferences.tts.voice ?? DEFAULT_TTS_CONFIG.voice,
        model: preferences.tts.model ?? DEFAULT_TTS_CONFIG.model,
        speed: preferences.tts.speed ?? DEFAULT_TTS_CONFIG.speed,
        chatterboxExaggeration: preferences.tts.chatterboxExaggeration ?? 0.5,
        chatterboxCfgWeight: preferences.tts.chatterboxCfgWeight ?? 0.5,
        autoReadNewMessages: preferences.tts.autoReadNewMessages ?? false,
      })
      lastSavedDataRef.current = preferences.tts as unknown as TTSFormValues
      setSaveStatus('idle')
    }
  }, [preferences?.tts, reset])
  
  // Auto-save on change with debouncing
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    
    if (!isDirty) {
      setSaveStatus('idle')
      return
    }
    
    if (!isValid) {
      setSaveStatus('idle')
      return
    }
    
    setSaveStatus('saving')
    
    saveTimeoutRef.current = setTimeout(() => {
      const formData = getValues()
      
      if (lastSavedDataRef.current && JSON.stringify(formData) === JSON.stringify(lastSavedDataRef.current)) {
        setSaveStatus('idle')
        return
      }
      
      updateSettings({ tts: formData })
      lastSavedDataRef.current = formData
      setSaveStatus('saved')
      
      setTimeout(() => {
        setSaveStatus('idle')
      }, 1500)
      
    }, 800)
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [watchEnabled, watchProvider, watchApiKey, watchEndpoint, watchVoice, watchModel, watchSpeed, watchChatterboxExaggeration, watchChatterboxCfgWeight, watchAutoReadNewMessages, isValid, isDirty, getValues, updateSettings])
  
  const handleTest = () => {
    const formData = getValues()
    speakWithConfig(TEST_PHRASE, formData)
  }
  
  const handleStopTest = () => {
    stop()
  }
  
  return (
    <div className="bg-card border-t pt-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Text-to-Speech</h2>
        {/* Show auto-save status instead of save button */}
        <div className="flex items-center gap-2 text-sm">
          {saveStatus === 'saving' && (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Saving...</span>
            </>
          )}
          {saveStatus === 'saved' && (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-green-600">Saved</span>
            </>
          )}
          {saveStatus === 'idle' && isDirty && isValid && (
            <span className="text-amber-600">Unsaved changes</span>
          )}
          {saveStatus === 'idle' && !isDirty && (
            <span className="text-muted-foreground">All changes saved</span>
          )}
        </div>
      </div>
      
      <Form {...form}>
        <form className="space-y-6">
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
                name="autoReadNewMessages"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Auto-Read New Messages</FormLabel>
                      <FormDescription>
                        Automatically read assistant responses aloud, even in background
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    form.setValue('provider', 'builtin', { shouldDirty: true })
                    form.setValue('apiKey', '', { shouldDirty: true })
                    form.setValue('endpoint', '', { shouldDirty: true })
                  }}
                  className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition ${
                    watchProvider === 'builtin'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-border hover:border-blue-300'
                  }`}
                >
                  <MonitorSpeaker className={`h-6 w-6 ${watchProvider === 'builtin' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
                  <span className={`font-medium ${watchProvider === 'builtin' ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                    Built-in Browser
                  </span>
                  <span className="text-xs text-muted-foreground text-center">
                    No setup required
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    form.setValue('provider', 'coqui', { shouldDirty: true })
                    form.setValue('apiKey', '', { shouldDirty: true })
                    form.setValue('endpoint', '', { shouldDirty: true })
                    form.setValue('voice', 'default', { shouldDirty: true })
                  }}
                  className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition ${
                    watchProvider === 'coqui'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-border hover:border-blue-300'
                  }`}
                >
                  <Cpu className={`h-6 w-6 ${watchProvider === 'coqui' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
                  <span className={`font-medium ${watchProvider === 'coqui' ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                    Coqui Jenny
                  </span>
                  <span className="text-xs text-muted-foreground text-center">
                    Fast local TTS
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    form.setValue('provider', 'chatterbox', { shouldDirty: true })
                    form.setValue('apiKey', '', { shouldDirty: true })
                    form.setValue('endpoint', '', { shouldDirty: true })
                    form.setValue('voice', 'default', { shouldDirty: true })
                  }}
                  className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition ${
                    watchProvider === 'chatterbox'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-border hover:border-blue-300'
                  }`}
                >
                  <Cpu className={`h-6 w-6 ${watchProvider === 'chatterbox' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
                  <span className={`font-medium ${watchProvider === 'chatterbox' ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                    Chatterbox
                  </span>
                  <span className="text-xs text-muted-foreground text-center">
                    Expressive AI
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    form.setValue('provider', 'external', { shouldDirty: true })
                  }}
                  className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition ${
                    watchProvider === 'external'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-border hover:border-blue-300'
                  }`}
                >
                  <Globe className={`h-6 w-6 ${watchProvider === 'external' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
                  <span className={`font-medium ${watchProvider === 'external' ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                    External API
                  </span>
                  <span className="text-xs text-muted-foreground text-center">
                    OpenAI, etc.
                  </span>
                </button>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Choose how you want to generate speech. Built-in, Coqui, and Chatterbox work locally without external API.
              </div>

              {/* Coqui Provider Settings */}
              {watchProvider === 'coqui' && (
                <>
                  <div className="rounded-lg border border-border p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium">Coqui TTS Server (Jenny)</h3>
                        <p className="text-sm text-muted-foreground">
                          {coquiStatus?.running ? (
                            <span className="text-green-600 dark:text-green-400">
                              Running on {coquiStatus.device || 'CPU'}
                              {coquiStatus.cudaAvailable && ' (CUDA available)'}
                            </span>
                          ) : (
                            <span className="text-yellow-600 dark:text-yellow-400">
                              {coquiStatus?.error || 'Not running'}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {coquiStatus?.running ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => stopCoquiMutation.mutate()}
                            disabled={stopCoquiMutation.isPending}
                          >
                            {stopCoquiMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <StopCircle className="h-4 w-4 mr-2" />
                            )}
                            Stop
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startCoquiMutation.mutate()}
                            disabled={startCoquiMutation.isPending}
                          >
                            {startCoquiMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <Play className="h-4 w-4 mr-2" />
                            )}
                            Start
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {startCoquiMutation.isPending && (
                      <div className="text-sm text-muted-foreground">
                        Starting server... This may take a minute on first run to download the Jenny model.
                      </div>
                    )}
                  </div>

                  <FormField
                    control={form.control}
                    name="voice"
                    render={({ field }) => {
                      const voiceOptions = (coquiVoices?.voiceDetails || []).map((v) => ({
                        value: v.id,
                        label: v.name
                      }))
                      
                      return (
                        <FormItem>
                          <FormLabel>Voice</FormLabel>
                          <FormControl>
                            <Combobox
                              value={field.value}
                              onChange={field.onChange}
                              options={voiceOptions.length > 0 ? voiceOptions : [{ value: 'default', label: 'Jenny (Default)' }]}
                              placeholder="Select a voice..."
                              disabled={!coquiStatus?.running}
                              allowCustomValue={false}
                            />
                          </FormControl>
                          <FormDescription>
                            {coquiStatus?.running 
                              ? `Model: ${coquiStatus.model}`
                              : 'Start the Coqui TTS server to use Jenny voice'}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )
                    }}
                  />
                </>
              )}

              {/* Chatterbox Provider Settings */}
              {watchProvider === 'chatterbox' && (
                <>
                  <div className="rounded-lg border border-border p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium">Chatterbox Server</h3>
                        <p className="text-sm text-muted-foreground">
                          {chatterboxStatus?.running ? (
                            <span className="text-green-600 dark:text-green-400">
                              Running on {chatterboxStatus.device || 'CPU'}
                              {chatterboxStatus.cudaAvailable && ' (CUDA available)'}
                            </span>
                          ) : (
                            <span className="text-yellow-600 dark:text-yellow-400">
                              {chatterboxStatus?.error || 'Not running'}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {chatterboxStatus?.running ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => stopChatterboxMutation.mutate()}
                            disabled={stopChatterboxMutation.isPending}
                          >
                            {stopChatterboxMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <StopCircle className="h-4 w-4 mr-2" />
                            )}
                            Stop
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startChatterboxMutation.mutate()}
                            disabled={startChatterboxMutation.isPending}
                          >
                            {startChatterboxMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <Play className="h-4 w-4 mr-2" />
                            )}
                            Start
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {startChatterboxMutation.isPending && (
                      <div className="text-sm text-muted-foreground">
                        Starting server... This may take a minute on first run to download the model.
                      </div>
                    )}
                  </div>

                  <FormField
                    control={form.control}
                    name="voice"
                    render={({ field }) => {
                      const voiceOptions = (chatterboxVoices?.voiceDetails || []).map((v) => ({
                        value: v.id,
                        label: `${v.name}${v.is_custom ? ' (custom)' : ''}`
                      }))
                      
                      return (
                        <FormItem>
                          <FormLabel>Voice</FormLabel>
                          <FormControl>
                            <Combobox
                              value={field.value}
                              onChange={field.onChange}
                              options={voiceOptions.length > 0 ? voiceOptions : [{ value: 'default', label: 'Default Voice' }]}
                              placeholder="Select a voice..."
                              disabled={!chatterboxStatus?.running}
                              allowCustomValue={false}
                            />
                          </FormControl>
                          <FormDescription>
                            {chatterboxStatus?.running 
                              ? `${chatterboxVoices?.voices?.length || 1} voice(s) available. Upload audio samples to add custom voices.`
                              : 'Start the Chatterbox server to see available voices'}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )
                    }}
                  />

                  <FormField
                    control={form.control}
                    name="chatterboxExaggeration"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex justify-between">
                          <FormLabel>Expressiveness</FormLabel>
                          <span className="text-sm text-muted-foreground">
                            {(field.value ?? 0.5).toFixed(2)}
                          </span>
                        </div>
                        <FormControl>
                          <Slider
                            min={0}
                            max={1}
                            step={0.1}
                            value={[field.value ?? 0.5]}
                            onValueChange={(values) => field.onChange(values[0])}
                            className="w-full"
                            disabled={!chatterboxStatus?.running}
                          />
                        </FormControl>
                        <FormDescription>
                          Controls emotional expressiveness. Higher values = more expressive speech.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="chatterboxCfgWeight"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex justify-between">
                          <FormLabel>CFG Weight</FormLabel>
                          <span className="text-sm text-muted-foreground">
                            {(field.value ?? 0.5).toFixed(2)}
                          </span>
                        </div>
                        <FormControl>
                          <Slider
                            min={0}
                            max={1}
                            step={0.1}
                            value={[field.value ?? 0.5]}
                            onValueChange={(values) => field.onChange(values[0])}
                            className="w-full"
                            disabled={!chatterboxStatus?.running}
                          />
                        </FormControl>
                        <FormDescription>
                          Classifier-free guidance weight. Higher = more adherence to text.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* External Provider Settings */}
              {watchProvider === 'external' && (
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
                            onChange={(e) => {
                              field.onChange(e)
                              // Auto-save will handle debounced save
                            }}
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
                            onChange={(e) => {
                              field.onChange(e)
                              // Auto-save will handle debounced save
                            }}
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
                </>
              )}

              {/* Builtin Provider Settings */}
              {watchProvider === 'builtin' && (
                <>
                  <FormField
                    control={form.control}
                    name="voice"
                    render={({ field }) => {
                      const voiceOptions = browserVoices.map((voice: string) => ({
                        value: voice,
                        label: voice
                      }))
                      
                      return (
                      <FormItem>
                        <FormLabel>Browser Voice</FormLabel>
                        <FormControl>
                          <Combobox
                            value={field.value}
                            onChange={field.onChange}
                            options={voiceOptions}
                            placeholder={isCheckingBuiltin ? "Loading voices..." : "Select a voice..."}
                            disabled={!watchEnabled || isCheckingBuiltin || browserVoices.length === 0}
                            allowCustomValue={false}
                          />
                        </FormControl>
                        <FormDescription>
                          {isCheckingBuiltin ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Checking for voices...
                            </span>
                          ) : browserVoices.length > 0 ? (
                            `${browserVoices.length} voices available in your browser`
                          ) : !hasWebSpeechSupport ? (
                            <span className="text-destructive">Web Speech API not supported in this browser</span>
                          ) : (
                            'No voices found - try refreshing'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                      )
                    }}
                  />

                  {!hasWebSpeechSupport && (
                    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4">
                      <div className="text-sm text-yellow-800 dark:text-yellow-200">
                        <strong>Browser Not Supported</strong>: Your browser doesn't support Web Speech API. 
                        Please use Chrome, Safari, Firefox, or Edge, or switch to an external API provider.
                      </div>
                    </div>
                  )}

                  {hasWebSpeechSupport && browserVoices.length === 0 && (
                    <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                      <div className="space-y-0.5">
                        <div className="text-base font-medium">Check for Voices</div>
                        <p className="text-sm text-muted-foreground">
                          Your browser may need permission to access voices
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCheckBuiltin}
                        disabled={isCheckingBuiltin}
                      >
                        {isCheckingBuiltin ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Checking...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Check for Voices
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}

              {/* Common Settings for both providers */}
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
                        onValueChange={(values) => field.onChange(values[0])}
                        className="w-full"
                      />
                    </FormControl>
                    <FormDescription>
                      Playback speed (0.25x to 4.0x). Note: Web Speech API has limited speed control.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <div className="text-base font-medium">Test TTS</div>
                  <p className="text-sm text-muted-foreground">
                    Verify your TTS configuration works
                  </p>
                  {ttsError && (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <XCircle className="h-4 w-4" />
                      {ttsError}
                    </p>
                  )}
                  {watchProvider === 'builtin' && !hasWebSpeechSupport && (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <XCircle className="h-4 w-4" />
                      Web Speech API is not available
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
