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
    if ('window' in globalThis && 'speechSynthesis' in window) {
      this.synthesis = window.speechSynthesis;
      this.voicesLoaded = false;
      
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

  isSupported(): boolean {
    return this.synthesis !== null;
  }

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

  async waitForVoices(): Promise<void> {
    if (this.voicesLoaded) return;
    await this.loadVoices();
  }

  hasVoice(nameOrUri: string): boolean {
    return this.getVoices().some(
      (v) => v.name === nameOrUri || v.voiceURI === nameOrUri
    );
  }

  findVoice(nameOrUri: string): WebSpeechVoice | undefined {
    return this.getVoices().find(
      (v) => v.name === nameOrUri || v.voiceURI === nameOrUri
    );
  }

  getDefaultVoice(): WebSpeechVoice | undefined {
    return this.getVoices().find((v) => v.default) || this.getVoices()[0];
  }

  getVoicesByLang(lang: string): WebSpeechVoice[] {
    return this.getVoices().filter((v) => v.lang.startsWith(lang));
  }

  speak(text: string, options: WebSpeechSynthesisOptions = {}): Promise<void> {
    if (!this.synthesis) {
      return Promise.reject(new Error('Web Speech API is not supported'));
    }

    if (!text || !text.trim()) {
      return Promise.reject(new Error('No text provided'));
    }

    return new Promise((resolve, reject) => {
      if (this.pendingReject) {
        this.pendingReject(new Error('Cancelled'));
      }

      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;

      if (options.voice) {
        const voice = this.findVoice(options.voice);
        if (voice) {
          utterance.voice = this.synthesis!.getVoices().find(
            (v) => v.voiceURI === voice.voiceURI
          ) || null;
        }
      }

      if (options.rate) {
        utterance.rate = Math.max(0.5, Math.min(2.0, options.rate));
      } else {
        utterance.rate = 1.0;
      }

      if (options.pitch !== undefined) {
        utterance.pitch = Math.max(0.0, Math.min(2.0, options.pitch));
      }

      if (options.volume !== undefined) {
        utterance.volume = Math.max(0.0, Math.min(1.0, options.volume));
      }

      this.pendingResolve = resolve;
      this.pendingReject = reject;

      utterance.onstart = () => {
      };

      utterance.onend = () => {
        this.currentUtterance = null;
        if (this.pendingResolve) {
          this.pendingResolve();
          this.pendingResolve = null;
          this.pendingReject = null;
        }
        this.onEndCallbacks.forEach((cb) => cb());
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

  async speakChunked(
    text: string,
    chunkSize: number = 200,
    options: WebSpeechSynthesisOptions = {}
  ): Promise<void> {
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

    for (const chunk of chunks) {
      try {
        await this.speak(chunk, options);
      } catch (e) {
        if (e instanceof Error && e.message === 'Cancelled') {
          return;
        }
        throw e;
      }
    }
  }

  estimateDuration(text: string, rate = 1.0): number {
    const wordsPerMinute = 150;
    const baseRate = 1.0;
    const adjustedRate = baseRate / rate;
    const wordCount = text.trim().split(/\s+/).length;
    const minutes = wordCount / (wordsPerMinute * adjustedRate);
    return minutes * 60 * 1000;
  }

  stop(): void {
    if (this.synthesis) {
      this.synthesis.cancel();
      this.currentUtterance = null;
    }
    if (this.pendingReject) {
      this.pendingReject(new Error('Cancelled'));
      this.pendingResolve = null;
      this.pendingReject = null;
    }
  }

  pause(): void {
    if (this.synthesis && this.currentUtterance) {
      this.synthesis.pause();
    }
  }

  resume(): void {
    if (this.synthesis && this.currentUtterance) {
      this.synthesis.resume();
    }
  }

  isSpeaking(): boolean {
    return this.synthesis ? this.synthesis.speaking : false;
  }

  isPaused(): boolean {
    return this.synthesis ? this.synthesis.paused : false;
  }

  onEnd(callback: () => void): void {
    this.onEndCallbacks.push(callback);
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallbacks.push(callback);
  }

  onBoundary(callback: (charIndex: number, charLength: number) => void): void {
    this.onBoundaryCallbacks.push(callback);
  }

  clearCallbacks(): void {
    this.onEndCallbacks = [];
    this.onErrorCallbacks = [];
    this.onBoundaryCallbacks = [];
  }
}

let synthesizerInstance: WebSpeechSynthesizer | null = null;

export function getWebSpeechSynthesizer(): WebSpeechSynthesizer {
  if (!synthesizerInstance) {
    synthesizerInstance = new WebSpeechSynthesizer();
  }
  return synthesizerInstance;
}

export async function getBrowserVoices(): Promise<WebSpeechVoice[]> {
  const synthesizer = getWebSpeechSynthesizer();
  await synthesizer.waitForVoices();
  return synthesizer.getVoices();
}

export function isWebSpeechSupported(): boolean {
  return 'window' in globalThis && 'speechSynthesis' in window;
}

export async function getAvailableVoiceNames(): Promise<string[]> {
  const voices = await getBrowserVoices();
  return voices.map((v) => v.name);
}
