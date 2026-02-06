import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useSettings } from '@/hooks/useSettings'
import { useSTT } from '@/hooks/useSTT'
import { isWebRecognitionSupported, getAvailableLanguages } from '@/lib/webSpeechRecognizer'
import { sttApi } from '@/api/stt'
import { Mic, Loader2, XCircle, CheckCircle2, RefreshCw, Eye, EyeOff } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { SquareFill } from '@/components/ui/square-fill'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Combobox } from '@/components/ui/combobox'
import { DEFAULT_STT_CONFIG } from '@/api/types/settings'

const sttFormSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['external', 'builtin']),
  endpoint: z.string(),
  apiKey: z.string(),
  model: z.string(),
  language: z.string(),
}).superRefine((data, ctx) => {
  if (!data.enabled) return

  if (data.provider === 'external') {
    if (!data.endpoint || data.endpoint.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpoint'],
        message: 'Endpoint is required for external provider',
      })
    }
  }
})

type STTFormValues = z.infer<typeof sttFormSchema>

export function STTSettings() {
  const { preferences, updateSettings } = useSettings()
  const { startRecording, stopRecording, abortRecording, isRecording, isProcessing, transcript, interimTranscript, error: sttError, isExternalProvider } = useSTT()

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isTesting, setIsTesting] = useState(false)
  const [testTranscript, setTestTranscript] = useState('')
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'failed'>('idle')
  const [showApiKey, setShowApiKey] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>(['whisper-1'])
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  const isWebSpeechAvailable = isWebRecognitionSupported()

  const form = useForm<STTFormValues>({
    resolver: zodResolver(sttFormSchema),
    defaultValues: {
      ...DEFAULT_STT_CONFIG,
      model: DEFAULT_STT_CONFIG.model || 'whisper-1',
    },
  })

  const { reset, formState: { isDirty, isValid }, getValues, setValue } = form

  const availableLanguages = getAvailableLanguages()

  const watchEnabled = form.watch('enabled')
  const watchProvider = form.watch('provider')
  const watchLanguage = form.watch('language')
  const watchEndpoint = form.watch('endpoint')
  const watchApiKey = form.watch('apiKey')
  const watchModel = form.watch('model')

  const fetchModels = async (forceRefresh = false) => {
    if (!watchEndpoint) return

    setIsLoadingModels(true)
    try {
      const response = await sttApi.getModels('default', forceRefresh)
      setAvailableModels(response.models.length > 0 ? response.models : ['whisper-1'])

      if (!watchModel && response.models.length > 0) {
        setValue('model', response.models[0])
      }
    } catch {
      setAvailableModels(['whisper-1'])
    } finally {
      setIsLoadingModels(false)
    }
  }

  useEffect(() => {
    if (watchProvider === 'external' && watchEndpoint) {
      const timer = setTimeout(() => {
        fetchModels()
      }, 500)
      return () => clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchProvider, watchEndpoint])

  const handleTest = async () => {
    if (isTesting || isRecording) {
      if (isExternalProvider) {
        stopRecording()
      } else {
        abortRecording()
        setIsTesting(false)
        if (testTranscript) {
          setTestResult('success')
        }
      }
      return
    }

    setTestTranscript('')
    setTestResult('idle')
    setIsTesting(true)
    await startRecording()
  }

  useEffect(() => {
    if (isTesting && !isRecording && !isProcessing) {
      if (transcript) {
        setTestTranscript(transcript)
        setTestResult('success')
        setTimeout(() => {
          setIsTesting(false)
        }, 1000)
      } else if (sttError) {
        setTestResult('failed')
        setIsTesting(false)
      }
    }
  }, [isTesting, isRecording, isProcessing, transcript, sttError])

  useEffect(() => {
    if (isTesting && interimTranscript && interimTranscript !== 'Processing...' && interimTranscript !== 'Recording...') {
      setTestTranscript(interimTranscript)
    }
  }, [isTesting, interimTranscript])

  useEffect(() => {
    if (preferences?.stt) {
      const sttPrefs = preferences.stt as typeof preferences.stt & { model?: string; availableModels?: string[] }
      reset({
        enabled: sttPrefs.enabled ?? DEFAULT_STT_CONFIG.enabled,
        provider: sttPrefs.provider ?? DEFAULT_STT_CONFIG.provider,
        endpoint: sttPrefs.endpoint ?? DEFAULT_STT_CONFIG.endpoint,
        apiKey: sttPrefs.apiKey ?? DEFAULT_STT_CONFIG.apiKey,
        model: sttPrefs.model ?? 'whisper-1',
        language: sttPrefs.language ?? DEFAULT_STT_CONFIG.language,
      })

      if (sttPrefs.availableModels && sttPrefs.availableModels.length > 0) {
        setAvailableModels(sttPrefs.availableModels)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences?.stt])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isDirty && isValid) {
        const formData = getValues()
        updateSettings({ stt: formData })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 1500)
      }
    }, 800)

    return () => clearTimeout(timer)
  }, [watchEnabled, watchProvider, watchLanguage, watchEndpoint, watchApiKey, watchModel, isDirty, isValid, getValues, updateSettings])

  const canTestBuiltin = watchEnabled && watchProvider === 'builtin' && isWebSpeechAvailable
  const canTestExternal = watchEnabled && watchProvider === 'external' && watchEndpoint
  const canTest = canTestBuiltin || canTestExternal

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Speech-to-Text</h2>
        <div className="flex items-center gap-2 text-sm">
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
                  <FormLabel className="text-base">Enable STT</FormLabel>
                  <FormDescription>
                    Allow speech-to-text input for voice messages
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
                name="provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        onChange={field.onChange}
                        options={[
                          ...(isWebSpeechAvailable ? [{ value: 'builtin', label: 'Built-in Browser' }] : []),
                          { value: 'external', label: 'External API (OpenAI Whisper)' },
                        ]}
                        placeholder="Select provider..."
                        allowCustomValue={false}
                      />
                    </FormControl>
                    <FormDescription>
                      {watchProvider === 'builtin' 
                        ? "Uses browser's built-in speech recognition (free, requires Chrome/Safari/Edge)"
                        : "Uses OpenAI Whisper API or compatible endpoint (requires API key)"
                      }
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchProvider === 'external' && (
                <>
                  <FormField
                    control={form.control}
                    name="endpoint"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>API Endpoint</FormLabel>
                        <FormControl>
                          <input
                            type="text"
                            placeholder="https://api.openai.com"
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-[16px] md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Base URL for the Whisper-compatible API (e.g., OpenAI, local Whisper server)
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
                          <div className="relative">
                            <input
                              type={showApiKey ? 'text' : 'password'}
                              placeholder="sk-..."
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-[16px] md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                              {...field}
                            />
                            <button
                              type="button"
                              onClick={() => setShowApiKey(!showApiKey)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormDescription>
                          Your API key for the speech-to-text service (optional for some servers)
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
                        <div className="flex items-center justify-between">
                          <FormLabel>Model</FormLabel>
                          <button
                            type="button"
                            onClick={() => fetchModels(true)}
                            disabled={isLoadingModels || !watchEndpoint}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3 w-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                            Refresh
                          </button>
                        </div>
                        <FormControl>
                          <Combobox
                            value={field.value}
                            onChange={field.onChange}
                            options={availableModels.map(model => ({
                              value: model,
                              label: model,
                            }))}
                            placeholder="Select model..."
                            disabled={isLoadingModels}
                            allowCustomValue={true}
                          />
                        </FormControl>
                        <FormDescription>
                          The speech-to-text model to use (e.g., whisper-1)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {watchProvider === 'builtin' && (
                <>
                  <FormField
                    control={form.control}
                    name="language"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Language</FormLabel>
                        <FormControl>
                          <Combobox
                            value={field.value}
                            onChange={field.onChange}
                            options={availableLanguages.map(lang => ({
                              value: lang,
                              label: lang.replace('-', ' - ')
                            }))}
                            placeholder="Select language..."
                            disabled={!isWebSpeechAvailable}
                            allowCustomValue={false}
                          />
                        </FormControl>
                        <FormDescription>
                          Select the language for speech recognition
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {sttError && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
                  <div className="text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>{sttError}</div>
                  </div>
                </div>
              )}

              <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5 flex-1 mr-4">
                  <div className="text-base font-medium">Test STT</div>
                  <p className="text-sm text-muted-foreground">
                    {watchProvider === 'external' 
                      ? 'Record audio, then click Stop to transcribe'
                      : 'Verify your speech recognition is working'
                    }
                  </p>
                  {(isTesting || isProcessing) && (
                    <div className="mt-2 p-2 bg-muted rounded max-h-24 overflow-y-auto">
                      <p className="text-sm">{testTranscript || (isProcessing ? 'Processing...' : 'Listening...')}</p>
                      {isRecording && (
                        <div className="flex items-center gap-1 mt-1">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          <span className="text-xs text-muted-foreground">Recording...</span>
                        </div>
                      )}
                      {isProcessing && !isRecording && (
                        <div className="flex items-center gap-1 mt-1">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          <span className="text-xs text-muted-foreground">Transcribing...</span>
                        </div>
                      )}
                    </div>
                  )}
                  {!isTesting && !isProcessing && testResult === 'success' && testTranscript && (
                    <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded max-h-24 overflow-y-auto">
                      <div className="flex items-center gap-1 mb-1">
                        <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                        <span className="text-xs font-medium text-green-700 dark:text-green-300">Test successful</span>
                      </div>
                      <p className="text-sm text-green-800 dark:text-green-200">{testTranscript}</p>
                    </div>
                  )}
                  {!isTesting && !isProcessing && testResult === 'failed' && (
                    <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                      <div className="flex items-center gap-1">
                        <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
                        <span className="text-xs font-medium text-red-700 dark:text-red-300">Test failed - {sttError || 'no speech detected'}</span>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={!canTest && !isRecording && !isProcessing}
                  className={`px-4 py-2 rounded-lg transition-all duration-200 active:scale-95 flex items-center gap-2 ${
                    !canTest && !isRecording && !isProcessing
                      ? 'bg-muted text-muted-foreground cursor-not-allowed'
                      : isRecording
                      ? 'bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-destructive-foreground border-2 border-red-500/60 shadow-lg shadow-red-500/30'
                      : isProcessing
                      ? 'bg-muted text-muted-foreground cursor-wait'
                      : 'bg-primary hover:bg-primary/90 text-primary-foreground'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <SquareFill className="w-4 h-4" />
                      Stop
                    </>
                  ) : isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4" />
                      Test
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </form>
      </Form>
    </div>
  )
}
