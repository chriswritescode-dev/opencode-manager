import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useSettings } from '@/hooks/useSettings'
import { useSTT } from '@/hooks/useSTT'
import { isWebRecognitionSupported, getAvailableLanguages } from '@/lib/webSpeechRecognizer'
import { Mic, Loader2, XCircle, CheckCircle2 } from 'lucide-react'
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
  language: z.string(),
  continuous: z.boolean(),
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
  const { startRecording, stopRecording, isRecording, interimTranscript, error: sttError } = useSTT()

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isTesting, setIsTesting] = useState(false)
  const [testTranscript, setTestTranscript] = useState('')

  const isWebSpeechAvailable = isWebRecognitionSupported()

  const form = useForm<STTFormValues>({
    resolver: zodResolver(sttFormSchema),
    defaultValues: DEFAULT_STT_CONFIG,
  })

  const { reset, formState: { isDirty, isValid }, getValues } = form

  const availableLanguages = getAvailableLanguages()

  const watchEnabled = form.watch('enabled')
  const watchProvider = form.watch('provider')
  const watchLanguage = form.watch('language')
  const watchContinuous = form.watch('continuous')

  const handleTest = async () => {
    if (isTesting) {
      stopRecording()
      setIsTesting(false)
      return
    }

    setTestTranscript('')
    setIsTesting(true)
    await startRecording()
  }

  useEffect(() => {
    if (isTesting && !isRecording && testTranscript) {
      setTimeout(() => {
        setIsTesting(false)
      }, 1000)
    }
  }, [isTesting, isRecording, testTranscript])

  useEffect(() => {
    if (isTesting) {
      setTestTranscript(interimTranscript)
    }
  }, [isTesting, interimTranscript])

  useEffect(() => {
    if (preferences?.stt) {
      reset({
        enabled: preferences.stt.enabled ?? DEFAULT_STT_CONFIG.enabled,
        provider: preferences.stt.provider ?? DEFAULT_STT_CONFIG.provider,
        endpoint: preferences.stt.endpoint ?? DEFAULT_STT_CONFIG.endpoint,
        apiKey: preferences.stt.apiKey ?? DEFAULT_STT_CONFIG.apiKey,
        language: preferences.stt.language ?? DEFAULT_STT_CONFIG.language,
        continuous: preferences.stt.continuous ?? DEFAULT_STT_CONFIG.continuous,
      })
    }
  }, [preferences?.stt, reset])

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
  }, [watchEnabled, watchProvider, watchLanguage, watchContinuous, isDirty, isValid, getValues, updateSettings])

  const canTest = watchEnabled && isWebSpeechAvailable

  return (
    <div className="bg-card border-t pt-4">
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

          {!isWebSpeechAvailable && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
              <div className="text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <strong>Browser Not Supported</strong>: Your browser doesn't support Web Speech Recognition API. 
                  Please use Chrome, Safari, or Edge, or switch to an external API provider when available.
                </div>
              </div>
            </div>
          )}

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
                          { value: 'builtin', label: 'Built-in Browser' },
                          { value: 'external', label: 'External API (Coming Soon)' },
                        ].filter(opt => opt.value === 'builtin' || isWebSpeechAvailable)}
                        placeholder="Select provider..."
                        disabled={!isWebSpeechAvailable}
                        allowCustomValue={false}
                      />
                    </FormControl>
                    <FormDescription>
                      Built-in uses browser's speech recognition. External API support coming soon.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchProvider === 'external' && (
                <FormField
                  control={form.control}
                  name="endpoint"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>STT Server URL</FormLabel>
                      <FormControl>
                        <input
                          type="text"
                          placeholder="https://api.example.com/stt"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Base URL of your STT service (coming soon)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

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
                        disabled={!isWebSpeechAvailable || watchProvider === 'external'}
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

              <FormField
                control={form.control}
                name="continuous"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Continuous Mode</FormLabel>
                      <FormDescription>
                        Keep listening after a pause (experimental)
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!isWebSpeechAvailable}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {(sttError || (!canTest && watchEnabled)) && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
                  <div className="text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      {sttError || 'STT is not available. Please enable it and ensure your browser supports speech recognition.'}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <div className="text-base font-medium">Test STT</div>
                  <p className="text-sm text-muted-foreground">
                    Verify your speech recognition is working
                  </p>
                  {isTesting && testTranscript && (
                    <div className="mt-2 p-2 bg-muted rounded max-h-24 overflow-y-auto">
                      <p className="text-sm">{testTranscript || 'Listening...'}</p>
                      {isRecording && (
                        <div className="flex items-center gap-1 mt-1">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          <span className="text-xs text-muted-foreground">Recording...</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={!canTest || isRecording}
                  className={`px-4 py-2 rounded-lg transition-all duration-200 active:scale-95 flex items-center gap-2 ${
                    !canTest
                      ? 'bg-muted text-muted-foreground cursor-not-allowed'
                      : isRecording
                      ? 'bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-destructive-foreground border-2 border-red-500/60 shadow-lg shadow-red-500/30'
                      : 'bg-primary hover:bg-primary/90 text-primary-foreground'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <SquareFill className="w-4 h-4" />
                      Stop
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
