import { TTSSettings } from './TTSSettings'
import { STTSettings } from './STTSettings'

export function VoiceSettings() {
  return (
    <div className="@container w-full max-w-7xl">
      <div className="grid gap-6 @min-[1000px]:grid-cols-2 @min-[1000px]:items-start">
        <div className="min-w-0">
          <TTSSettings />
        </div>
        <div className="min-w-0">
          <STTSettings />
        </div>
      </div>
    </div>
  )
}
