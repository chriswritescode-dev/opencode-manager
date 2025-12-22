/**
 * Web Speech API synthesizer - Browser-native TTS without external dependencies
 */

export interface WebSpeechVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface WebSpeechSynthesisOptions {
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export class WebSpeechSynthesizer {
  private synthesis: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private voices: WebSpeechVoice[] = [];
  private voicesLoaded = false;
  private onEndCallbacks: (() => void)[] = [];
  private onErrorCallbacks: ((error: string) => void)[] = [];
  private onBoundaryCallbacks: ((charIndex: number, charLength: number) => void)[] = [];
  private pendingResolve: (() => void) | null = null;
  private pendingReject: ((error: Error) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synthesis = window.speechSynthesis;
      this.voicesLoaded = false;
      
      // Load voices asynchronously
      this.loadVoices();
    }
  }

  private loadVoices(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.synthesis) {
        resolve();
        return;
      }

      const synthesis = this.synthesis;

      const load = () => {
        const voices = synthesis.getVoices();
        if (voices.length > 0) {
          this.voices = voices.map((v) => ({
            voiceURI: v.voiceURI,
            name: v.name,
            lang: v.lang,
            localService: v.localService,
            default: v.default,
          }));
          this.voicesLoaded = true;
          resolve();
        } else {
          // Wait for voices to load
          const timeout = setTimeout(() => {
            if (!this.voicesLoaded) {
              this.voicesLoaded = true;
              resolve();
            }
          }, 3000);

          synthesis.onvoiceschanged = () => {
            clearTimeout(timeout);
            load();
          };
        }
      };

      load();
    });
  }

  /**
   * Check if Web Speech API is available
   */
  isSupported(): boolean {
    return this.synthesis !== null;
  }

  /**
   * Get all available voices
   */
  getVoices(): WebSpeechVoice[] {
    if (!this.voicesLoaded) {
      if (this.synthesis) {
        const voices = this.synthesis.getVoices();
        if (voices.length > 0) {
          this.voices = voices.map((v) => ({
            voiceURI: v.voiceURI,
            name: v.name,
            lang: v.lang,
            localService: v.localService,
            default: v.default,
          }));
          this.voicesLoaded = true;
        }
      }
    }
    return this.voices;
  }

  /**
   * Wait for voices to be loaded
   */
  async waitForVoices(): Promise<void> {
    if (this.voicesLoaded) return;
    await this.loadVoices();
  }

  /**
   * Check if a specific voice is available
   */
  hasVoice(nameOrUri: string): boolean {
    return this.getVoices().some(
      (v) => v.name === nameOrUri || v.voiceURI === nameOrUri
    );
  }

  /**
   * Find a voice by name or URI
   */
  findVoice(nameOrUri: string): WebSpeechVoice | undefined {
    return this.getVoices().find(
      (v) => v.name === nameOrUri || v.voiceURI === nameOrUri
    );
  }

  /**
   * Get default voice
   */
  getDefaultVoice(): WebSpeechVoice | undefined {
    return this.getVoices().find((v) => v.default) || this.getVoices()[0];
  }

  /**
   * Get available voices for a specific language
   */
  getVoicesByLang(lang: string): WebSpeechVoice[] {
    return this.getVoices().filter((v) => v.lang.startsWith(lang));
  }

  /**
   * Speak text using Web Speech API
   */
  speak(text: string, options: WebSpeechSynthesisOptions = {}): Promise<void> {
    if (!this.synthesis) {
      return Promise.reject(new Error('Web Speech API is not supported'));
    }

    if (!text || !text.trim()) {
      return Promise.reject(new Error('No text provided'));
    }

    return new Promise((resolve, reject) => {
      // Reject any pending promise (for cancellation)
      if (this.pendingReject) {
        this.pendingReject(new Error('Cancelled'));
      }

      // Stop any ongoing speech
      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;

      // Configure utterance
      if (options.voice) {
        const voice = this.findVoice(options.voice);
        if (voice) {
          utterance.voice = this.synthesis!.getVoices().find(
            (v) => v.voiceURI === voice.voiceURI
          ) || null;
        }
      }

      // Speed (rate): Web Speech API uses 1.0 as default, range typically 0.1 to 10
      // We need to convert from our 0.25-4.0 scale to a reasonable range
      // Keep it within 0.5 to 2.0 for better intelligibility
      if (options.rate) {
        utterance.rate = Math.max(0.5, Math.min(2.0, options.rate));
      } else {
        utterance.rate = 1.0;
      }

      // Pitch: 0.0 to 2.0, default 1.0
      if (options.pitch !== undefined) {
        utterance.pitch = Math.max(0.0, Math.min(2.0, options.pitch));
      }

      // Volume: 0.0 to 1.0
      if (options.volume !== undefined) {
        utterance.volume = Math.max(0.0, Math.min(1.0, options.volume));
      }

      // Store pending promise handlers for cancellation
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      // Event handlers
      utterance.onstart = () => {
        // Started speaking
      };

      utterance.onend = () => {
        this.currentUtterance = null;
        if (this.pendingResolve) {
          this.pendingResolve();
          this.pendingResolve = null;
          this.pendingReject = null;
        }
        this.onEndCallbacks.forEach((cb) => cb());
        resolve();
      };

      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        this.currentUtterance = null;
        const errorMessage = event.error || 'Speech synthesis error';
        if (this.pendingReject) {
          this.pendingReject(new Error(errorMessage));
          this.pendingResolve = null;
          this.pendingReject = null;
        }
        this.onErrorCallbacks.forEach((cb) => cb(errorMessage));
        reject(new Error(errorMessage));
      };

      utterance.onboundary = (event) => {
        if (event.name === 'word' || event.name === 'sentence') {
          this.onBoundaryCallbacks.forEach((cb) =>
            cb(event.charIndex, event.charLength || 0)
          );
        }
      };

      if (this.synthesis) {
        this.synthesis.speak(utterance);
      }
    });
  }

  /**
   * Speak text with support for chunking
   */
  async speakChunked(
    text: string,
    chunkSize: number = 200,
    options: WebSpeechSynthesisOptions = {}
  ): Promise<void> {
    // Split text into chunks by sentences first
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > chunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence + ' ';
      } else {
        currentChunk += sentence + ' ';
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    // Speak each chunk sequentially
    for (const chunk of chunks) {
      try {
        await this.speak(chunk, options);
      } catch (e) {
        // If stopped (cancelled), stop the chunked sequence
        if (e instanceof Error && e.message === 'Cancelled') {
          return;
        }
        // Re-throw real errors
        throw e;
      }
    }
  }

  /**
   * Estimate speech duration
   */
  estimateDuration(text: string, rate = 1.0): number {
    const wordsPerMinute = 150;
    const baseRate = 1.0;
    const adjustedRate = baseRate / rate;
    const wordCount = text.trim().split(/\s+/).length;
    const minutes = wordCount / (wordsPerMinute * adjustedRate);
    return minutes * 60 * 1000; // Convert to milliseconds
  }

  /**
   * Stop current speech
   */
  stop(): void {
    if (this.synthesis) {
      this.synthesis.cancel();
      this.currentUtterance = null;
    }
    // Reject any pending promise
    if (this.pendingReject) {
      this.pendingReject(new Error('Cancelled'));
      this.pendingResolve = null;
      this.pendingReject = null;
    }
  }

  /**
   * Pause current speech
   */
  pause(): void {
    if (this.synthesis && this.currentUtterance) {
      this.synthesis.pause();
    }
  }

  /**
   * Resume paused speech
   */
  resume(): void {
    if (this.synthesis && this.currentUtterance) {
      this.synthesis.resume();
    }
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return this.synthesis ? this.synthesis.speaking : false;
  }

  /**
   * Check if currently paused
   */
  isPaused(): boolean {
    return this.synthesis ? this.synthesis.paused : false;
  }

  /**
   * Register callback when speech ends
   */
  onEnd(callback: () => void): void {
    this.onEndCallbacks.push(callback);
  }

  /**
   * Register callback when speech errors
   */
  onError(callback: (error: string) => void): void {
    this.onErrorCallbacks.push(callback);
  }

  /**
   * Register callback for speech boundaries
   */
  onBoundary(callback: (charIndex: number, charLength: number) => void): void {
    this.onBoundaryCallbacks.push(callback);
  }

  /**
   * Clear all callbacks
   */
  clearCallbacks(): void {
    this.onEndCallbacks = [];
    this.onErrorCallbacks = [];
    this.onBoundaryCallbacks = [];
  }
}

// Singleton instance
let synthesizerInstance: WebSpeechSynthesizer | null = null;

export function getWebSpeechSynthesizer(): WebSpeechSynthesizer {
  if (!synthesizerInstance) {
    synthesizerInstance = new WebSpeechSynthesizer();
  }
  return synthesizerInstance;
}

/**
 * Utility function to get browser voices for frontend
 */
export async function getBrowserVoices(): Promise<WebSpeechVoice[]> {
  const synthesizer = getWebSpeechSynthesizer();
  await synthesizer.waitForVoices();
  return synthesizer.getVoices();
}

/**
 * Check if Web Speech API is available
 */
export function isWebSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Get available voice names as a simple list
 */
export async function getAvailableVoiceNames(): Promise<string[]> {
  const voices = await getBrowserVoices();
  return voices.map((v) => v.name);
}
