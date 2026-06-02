export type AudioRecorderState = 'idle' | 'recording' | 'stopped' | 'error'

export interface AudioRecorderOptions {
  mimeTypes?: string[]
  audioConstraints?: MediaTrackConstraints
}

const DEFAULT_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/wav',
]

function selectMimeType(configured?: string[]): string | undefined {
  const candidates = configured && configured.length > 0 ? configured : PREFERRED_MIME_TYPES
  return candidates.find(type => MediaRecorder.isTypeSupported(type))
}

export class AudioRecorder {
  private state: AudioRecorderState = 'idle'
  private mediaStream: MediaStream | null = null
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private firstChunkType = ''
  private isAborted = false
  private options: AudioRecorderOptions
  private outputType = ''

  private onStateChange?: (state: AudioRecorderState) => void
  private onError?: (error: string) => void
  private onDataAvailable?: (blob: Blob) => void
  private onNoSpeech?: () => void

  constructor(options: AudioRecorderOptions = {}) {
    this.options = options
  }

  static isSupported(): boolean {
    return !!(
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined'
    )
  }

  async prepare(): Promise<void> {
    if (!AudioRecorder.isSupported()) {
      throw new Error('Audio recording is not supported in this browser')
    }
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

  setOnNoSpeech(callback: () => void): void {
    this.onNoSpeech = callback
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
      this.firstChunkType = ''

      const audioConstraints = {
        ...DEFAULT_AUDIO_CONSTRAINTS,
        ...this.options.audioConstraints,
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })

      if (this.isAborted) {
        this.cleanup()
        return
      }

      const selectedMimeType = selectMimeType(this.options.mimeTypes)
      this.mediaRecorder = new MediaRecorder(
        this.mediaStream,
        selectedMimeType ? { mimeType: selectedMimeType } : undefined,
      )

      this.outputType = this.mediaRecorder.mimeType || selectedMimeType || ''

      this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) {
          if (this.chunks.length === 0 && e.data.type) {
            this.firstChunkType = e.data.type
          }
          this.chunks.push(e.data)
        }
      }

      this.mediaRecorder.onstop = () => {
        this.finishRecording()
      }

      this.mediaRecorder.onerror = () => {
        this.setState('error')
        this.onError?.('MediaRecorder error')
        this.cleanup()
      }

      this.mediaRecorder.start()
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
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
      return
    }
    this.mediaRecorder.stop()
  }

  private finishRecording(): void {
    if (this.isAborted) {
      return
    }

    const type = this.outputType || this.firstChunkType || ''
    const combinedBlob = new Blob(this.chunks, { type })

    if (this.chunks.length === 0 || combinedBlob.size === 0) {
      this.onNoSpeech?.()
    } else {
      this.onDataAvailable?.(combinedBlob)
    }

    this.stopTracks()
    this.mediaRecorder = null
    this.mediaStream = null
    this.chunks = []
    this.setState('stopped')
  }

  abort(): void {
    this.teardown()
  }

  dispose(): void {
    this.teardown()
  }

  private teardown(): void {
    this.isAborted = true
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop()
    }
    this.stopTracks()
    this.mediaRecorder = null
    this.mediaStream = null
    this.chunks = []
    this.firstChunkType = ''
    this.setState('idle')
  }

  private stopTracks(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
    }
  }

  private cleanup(): void {
    this.stopTracks()
    this.mediaRecorder = null
    this.mediaStream = null
    this.chunks = []
    this.firstChunkType = ''
  }
}
