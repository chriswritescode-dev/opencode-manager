export type AudioRecorderState = 'idle' | 'recording' | 'stopped' | 'error'

export interface AudioRecorderOptions {
  mimeType?: string
  audioBitsPerSecond?: number
}

const DEFAULT_OPTIONS: AudioRecorderOptions = {
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 128000,
}

function getSupportedMimeType(): string {
  const mimeTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]

  for (const mimeType of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }

  return 'audio/webm'
}

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private audioChunks: Blob[] = []
  private stream: MediaStream | null = null
  private state: AudioRecorderState = 'idle'
  private options: AudioRecorderOptions

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
      typeof window.MediaRecorder === 'function'
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
      this.audioChunks = []
      
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      const mimeType = getSupportedMimeType()
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: this.options.audioBitsPerSecond,
      })

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data)
        }
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm'
        const audioBlob = new Blob(this.audioChunks, { type: mimeType })
        this.onDataAvailable?.(audioBlob)
        this.setState('stopped')
        this.cleanup()
      }

      this.mediaRecorder.onerror = () => {
        this.setState('error')
        this.onError?.('Recording error occurred')
        this.cleanup()
      }

      this.mediaRecorder.start(100)
      this.setState('recording')
    } catch (error) {
      this.setState('error')
      
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
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
    }
  }

  abort(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
    }
    this.audioChunks = []
    this.setState('idle')
    this.cleanup()
  }

  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    this.mediaRecorder = null
  }

  getRecordingBlob(): Blob | null {
    if (this.audioChunks.length === 0) {
      return null
    }
    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm'
    return new Blob(this.audioChunks, { type: mimeType })
  }
}

let recorderInstance: AudioRecorder | null = null

export function getAudioRecorder(): AudioRecorder {
  if (!recorderInstance) {
    recorderInstance = new AudioRecorder()
  }
  return recorderInstance
}

export function isAudioRecordingSupported(): boolean {
  return AudioRecorder.isSupported()
}
