import { useEffect, useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useSettings } from '@/hooks/useSettings'
import { useSTT } from '@/hooks/useSTT'
import { useSTTModels, useSTTStatus } from '@/hooks/useSTTDiscovery'
import { Loader2, Mic, Square, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Combobox } from '@/components/ui/combobox'

const LANGUAGES = [
  { value: '', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
]

const sttFormSchema = z.object({
  enabled: z.boolean(),
  model: z.string(),
  language: z.string().optional(),
  autoSubmit: z.boolean(),
})

type STTFormValues = z.infer<typeof sttFormSchema>

const DEFAULT_STT_CONFIG = {
  enabled: false,
  model: 'base',
  language: '',
  autoSubmit: false,
}

export function STTSettings() {
  const { preferences, updateSettings } = useSettings()
  const { startRecording, stopRecording, isRecording, isTranscribing, error: sttError } = useSTT()
  const [testResult, setTestResult] = useState<string | null>(null)
  
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedDataRef = useRef<STTFormValues | null>(null)
  
  const form = useForm<STTFormValues>({
    resolver: zodResolver(sttFormSchema),
    defaultValues: DEFAULT_STT_CONFIG,
  })
  
  const { reset, formState: { isDirty, isValid }, getValues } = form
  
  const { data: modelsData, isLoading: isLoadingModels } = useSTTModels()
  const { data: statusData } = useSTTStatus()
  
  const availableModels = modelsData?.models || ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3']
  const serverRunning = statusData?.server?.running ?? false
  
  const watchEnabled = form.watch('enabled')
  const watchModel = form.watch('model')
  const watchLanguage = form.watch('language')
  const watchAutoSubmit = form.watch('autoSubmit')
  
  useEffect(() => {
    if (preferences?.stt) {
      reset({
        enabled: preferences.stt.enabled ?? DEFAULT_STT_CONFIG.enabled,
        model: preferences.stt.model ?? DEFAULT_STT_CONFIG.model,
        language: preferences.stt.language ?? DEFAULT_STT_CONFIG.language,
        autoSubmit: preferences.stt.autoSubmit ?? DEFAULT_STT_CONFIG.autoSubmit,
      })
      lastSavedDataRef.current = preferences.stt as STTFormValues
      setSaveStatus('idle')
    }
  }, [preferences?.stt, reset])
  
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
      
      updateSettings({ stt: formData })
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
  }, [watchEnabled, watchModel, watchLanguage, watchAutoSubmit, isValid, isDirty, getValues, updateSettings])
  
  const handleTest = async () => {
    setTestResult(null)
    await startRecording()
  }
  
  const handleStopTest = async () => {
    const text = await stopRecording()
    if (text) {
      setTestResult(text)
    }
  }
  
  const canTest = watchEnabled && serverRunning && !isLoadingModels
  
  return (
    <div className="bg-card border-t pt-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">Speech-to-Text</h2>
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
                  <FormLabel className="text-base">Enable STT</FormLabel>
                  <FormDescription>
                    Allow voice input for messages using Faster Whisper
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
              <div className={`flex items-center gap-2 p-3 rounded-lg border ${serverRunning ? 'border-green-500/50 bg-green-500/10' : 'border-yellow-500/50 bg-yellow-500/10'}`}>
                {serverRunning ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-green-700 dark:text-green-300">
                      Whisper server running (model: {statusData?.server?.model || 'loading...'})
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm text-yellow-700 dark:text-yellow-300">
                      Whisper server starting... (this may take a moment on first run)
                    </span>
                  </>
                )}
              </div>

              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Whisper Model</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        onChange={field.onChange}
                        options={availableModels.map((model: string) => ({
                          value: model,
                          label: model
                        }))}
                        placeholder="Select a model..."
                        disabled={!watchEnabled || isLoadingModels}
                        allowCustomValue={false}
                      />
                    </FormControl>
                    <FormDescription>
                      {isLoadingModels ? 'Loading models...' : (
                        <>
                          Larger models are more accurate but slower. 
                          <br />
                          <span className="text-muted-foreground">
                            tiny (~75MB) | base (~145MB) | small (~483MB) | medium (~1.5GB) | large (~3GB)
                          </span>
                        </>
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Language</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value || ''}
                        onChange={field.onChange}
                        options={LANGUAGES}
                        placeholder="Auto-detect"
                        disabled={!watchEnabled}
                        allowCustomValue={false}
                      />
                    </FormControl>
                    <FormDescription>
                      Select a language or let Whisper auto-detect
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="autoSubmit"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Auto-submit</FormLabel>
                      <FormDescription>
                        Automatically send message after transcription completes
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

              <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <div className="text-base font-medium">Test STT</div>
                  <p className="text-sm text-muted-foreground">
                    Record a short message to test your configuration
                  </p>
                  {sttError && (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      {sttError}
                    </p>
                  )}
                  {testResult && (
                    <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                      Result: "{testResult}"
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={isRecording ? handleStopTest : handleTest}
                  disabled={!canTest}
                >
                  {isTranscribing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Transcribing...
                    </>
                  ) : isRecording ? (
                    <>
                      <Square className="h-4 w-4 mr-2" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4 mr-2" />
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
