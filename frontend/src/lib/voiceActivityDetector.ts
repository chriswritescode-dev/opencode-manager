export interface VadOptions {
  sampleRate: number
  silenceFloor: number
  speechMultiplier: number
  silenceTimeoutMs: number
  minSpeechMs: number
  noiseFloorSmoothing: number
}

export const DEFAULT_VAD_OPTIONS: Omit<VadOptions, 'sampleRate'> = {
  silenceFloor: 0.008,
  speechMultiplier: 2.5,
  silenceTimeoutMs: 1500,
  minSpeechMs: 150,
  noiseFloorSmoothing: 0.95,
}

export interface VadFrameResult {
  isSpeech: boolean
  shouldAutoStop: boolean
}

export class VoiceActivityDetector {
  private readonly options: VadOptions
  private noiseFloor: number
  private speechSamples = 0
  private trailingSilenceSamples = 0
  private speechStarted = false

  constructor(options: Partial<VadOptions> & Pick<VadOptions, 'sampleRate'>) {
    this.options = { ...DEFAULT_VAD_OPTIONS, ...options }
    this.noiseFloor = this.options.silenceFloor
  }

  process(rms: number, frameSamples: number): VadFrameResult {
    const { silenceFloor, speechMultiplier, noiseFloorSmoothing, silenceTimeoutMs } = this.options
    const threshold = Math.max(silenceFloor, this.noiseFloor * speechMultiplier)
    const isSpeech = rms >= threshold

    if (isSpeech) {
      this.speechStarted = true
      this.speechSamples += frameSamples
      this.trailingSilenceSamples = 0
    } else {
      this.noiseFloor = noiseFloorSmoothing * this.noiseFloor + (1 - noiseFloorSmoothing) * rms
      if (this.speechStarted) {
        this.trailingSilenceSamples += frameSamples
      }
    }

    const shouldAutoStop =
      silenceTimeoutMs > 0 &&
      this.speechStarted &&
      this.samplesToMs(this.trailingSilenceSamples) >= silenceTimeoutMs

    return { isSpeech, shouldAutoStop }
  }

  get hasSpeech(): boolean {
    return this.samplesToMs(this.speechSamples) >= this.options.minSpeechMs
  }

  reset(): void {
    this.noiseFloor = this.options.silenceFloor
    this.speechSamples = 0
    this.trailingSilenceSamples = 0
    this.speechStarted = false
  }

  private samplesToMs(samples: number): number {
    return (samples / this.options.sampleRate) * 1000
  }
}
