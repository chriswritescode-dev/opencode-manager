export type AudioRecorderState = 'idle' | 'recording' | 'stopped' | 'error'

export interface AudioRecorderOptions {
  sampleRate?: number
  channelCount?: number
}

const DEFAULT_OPTIONS: AudioRecorderOptions = {
  sampleRate: 16000,
  channelCount: 1,
}

const workletModulePromises = new WeakMap<AudioContext, Promise<void>>()

function ensureWorkletLoaded(ctx: AudioContext): Promise<void> {
  const existingPromise = workletModulePromises.get(ctx)

  if (existingPromise) {
    return existingPromise
  }

  const promise = ctx.audioWorklet.addModule('/audio-worklet-processor.js')
  workletModulePromises.set(ctx, promise)
  return promise
}

export function downsampleAndConvert(input: Float32Array, inputRate: number, targetRate: number): Int16Array {
  const ratio = inputRate / targetRate
  const outputLength = Math.floor(input.length / ratio)
  const output = new Int16Array(outputLength)
  
  for (let i = 0; i < outputLength; i++) {
    const index = i * ratio
    const prevIndex = Math.floor(index)
    const nextIndex = prevIndex + 1
    const t = index - prevIndex
    
    let sample: number
    if (nextIndex >= input.length) {
      sample = input[prevIndex]
    } else {
      sample = input[prevIndex] * (1 - t) + input[nextIndex] * t
    }
    
    const clamped = Math.max(-1, Math.min(1, sample))
    output[i] = clamped < 0 ? clamped * 32768 : clamped * 32767
  }
  
  return output
}

export function encodeWavFromInt16(samples: Int16Array, sampleRate: number, channels: number): Blob {
  const dataLength = samples.length * 2
  const bufferSize = 44 + dataLength
  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)
  
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)
  
  new Int16Array(buffer, 44).set(samples)
  
  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

export class AudioRecorder {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private chunks: Int16Array[] = []
  private totalSamples: number = 0
  private state: AudioRecorderState = 'idle'
  private options: AudioRecorderOptions
  private isAborted: boolean = false

  private onStateChange?: (state: AudioRecorderState) => void
  private onError?: (error: string) => void
  private onDataAvailable?: (blob: Blob) => void

  constructor(options: AudioRecorderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  static isSupported(): boolean {
    return !!(
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window !== 'undefined' &&
      typeof window.AudioContext !== 'undefined'
    )
  }

  getState(): AudioRecorderState {
    return this.state
  }

  setOnStateChange(callback: (state: AudioRecorderState) => void): void {
    this.onStateChange = callback
  }

  setOnError(callback: (error: string) => void): void {
    this.onError = callback
  }

  setOnDataAvailable(callback: (blob: Blob) => void): void {
    this.onDataAvailable = callback
  }

  private setState(newState: AudioRecorderState): void {
    this.state = newState
    this.onStateChange?.(newState)
  }

  async start(): Promise<void> {
    if (!AudioRecorder.isSupported()) {
      this.setState('error')
      this.onError?.('Audio recording is not supported in this browser')
      throw new Error('Audio recording is not supported in this browser')
    }

    try {
      this.isAborted = false
      this.chunks = []
      this.totalSamples = 0

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      this.audioContext = new AudioContext({
        sampleRate: this.options.sampleRate,
      })

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream)

      if (this.audioContext.audioWorklet) {
        try {
          await ensureWorkletLoaded(this.audioContext)
          this.workletNode = new AudioWorkletNode(this.audioContext, 'recorder-processor', {
            processorOptions: { targetSampleRate: this.options.sampleRate },
          })
          this.workletNode.port.onmessage = (e: MessageEvent<Int16Array>) => {
            this.chunks.push(e.data)
            this.totalSamples += e.data.length
          }
          this.source.connect(this.workletNode)
        } catch (error) {
          this.audioContext.close()
          this.audioContext = null
          throw new Error('Failed to load audio worklet processor', { cause: error })
        }
      } else if (this.audioContext) {
        const bufferSize = 4096
        this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1)
        const targetRate = this.options.sampleRate ?? 16000
        const inputRate = this.audioContext.sampleRate
        this.processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0)
          const int16Chunk = downsampleAndConvert(inputData, inputRate, targetRate)
          this.chunks.push(int16Chunk)
          this.totalSamples += int16Chunk.length
        }
        this.source.connect(this.processor)
      }

      this.setState('recording')
    } catch (error) {
      this.setState('error')
      this.cleanup()

      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          this.onError?.('Microphone permission denied')
        } else if (error.name === 'NotFoundError') {
          this.onError?.('No microphone found')
        } else {
          this.onError?.(`Microphone error: ${error.message}`)
        }
      } else {
        this.onError?.('Failed to start recording')
      }

      throw error
    }
  }

  stop(): void {
    if (this.processor || this.workletNode) {
      this.processRecording()
    }
    this.resetRecordingState()
    this.cleanup()
    this.setState('stopped')
  }

  abort(): void {
    this.isAborted = true
    this.resetRecordingState()
    this.cleanup()
    this.setState('idle')
  }

  private processRecording(): void {
    if (this.isAborted || this.chunks.length === 0 || this.totalSamples === 0) {
      return
    }

    try {
      const merged = new Int16Array(this.totalSamples)
      let offset = 0
      for (const chunk of this.chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      const wavBlob = encodeWavFromInt16(merged, this.options.sampleRate ?? 16000, 1)
      this.onDataAvailable?.(wavBlob)
    } catch {
      this.onError?.('Failed to process recording')
      this.setState('error')
    }
  }

  private cleanup(): void {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null
      this.workletNode.port.postMessage('stop')
      this.workletNode.disconnect()
      this.workletNode = null
    }

    if (this.processor) {
      this.processor.onaudioprocess = null
      this.processor.disconnect()
      this.processor = null
    }

    if (this.source) {
      this.source.disconnect()
      this.source = null
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close()
      this.audioContext = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
      this.mediaStream = null
    }
  }

  private resetRecordingState(): void {
    this.chunks = []
    this.totalSamples = 0
  }
}
