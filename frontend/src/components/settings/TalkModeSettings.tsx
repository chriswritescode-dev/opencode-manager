import { useSettings } from '@/hooks/useSettings'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { DEFAULT_TALK_MODE_CONFIG } from '@opencode-manager/shared'

export function TalkModeSettings() {
  const { preferences, updateSettings } = useSettings()
  
  const talkModeConfig = preferences?.talkMode ?? DEFAULT_TALK_MODE_CONFIG
  const sttEnabled = preferences?.stt?.enabled ?? false
  const ttsEnabled = preferences?.tts?.enabled ?? false
  
  const canEnable = sttEnabled && ttsEnabled

  const handleTalkModeChange = (updates: Partial<typeof talkModeConfig>) => {
    updateSettings({
      talkMode: {
        ...talkModeConfig,
        ...updates,
      },
    })
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6">Talk Mode</h2>
      
      <div className="space-y-6">
        <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="talkModeEnabled" className="text-base">Enable Talk Mode</Label>
            <p className="text-sm text-muted-foreground">
              {canEnable 
                ? 'Hands-free voice conversation with the agent'
                : 'Requires both STT and TTS to be enabled first'}
            </p>
          </div>
          <Switch
            id="talkModeEnabled"
            checked={talkModeConfig.enabled}
            onCheckedChange={(checked) => handleTalkModeChange({ enabled: checked })}
            disabled={!canEnable}
          />
        </div>

        {talkModeConfig.enabled && (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="silenceThreshold">Silence Detection</Label>
                  <span className="text-sm text-muted-foreground">
                    {talkModeConfig.silenceThresholdMs}ms
                  </span>
                </div>
                <Slider
                  id="silenceThreshold"
                  min={300}
                  max={2000}
                  step={100}
                  value={[talkModeConfig.silenceThresholdMs]}
                  onValueChange={([value]) => handleTalkModeChange({ silenceThresholdMs: value })}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  How long to wait after you stop speaking before processing. Lower = faster response, higher = allows longer pauses.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="minSpeech">Minimum Speech Duration</Label>
                  <span className="text-sm text-muted-foreground">
                    {talkModeConfig.minSpeechMs}ms
                  </span>
                </div>
                <Slider
                  id="minSpeech"
                  min={200}
                  max={1000}
                  step={50}
                  value={[talkModeConfig.minSpeechMs]}
                  onValueChange={([value]) => handleTalkModeChange({ minSpeechMs: value })}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Minimum duration of speech to trigger processing. Helps filter out accidental sounds.
                </p>
              </div>
            </div>

            <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="autoInterrupt" className="text-base">Auto-Interrupt (Barge-in)</Label>
                <p className="text-sm text-muted-foreground">
                  Speaking while the agent is responding will stop its speech
                </p>
              </div>
              <Switch
                id="autoInterrupt"
                checked={talkModeConfig.autoInterrupt}
                onCheckedChange={(checked) => handleTalkModeChange({ autoInterrupt: checked })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
