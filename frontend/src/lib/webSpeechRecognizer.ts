/**
 * Web Speech API recognizer - Browser-native STT without external dependencies
 */

export interface SpeechRecognitionResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
}

export interface SpeechRecognitionOptions {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
}

export type RecognitionState = 'idle' | 'listening' | 'processing' | 'error';

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (event: Event) => void;
  onend: (event: Event) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionAlternativeList;
  [index: number]: SpeechRecognitionAlternativeList;
}

interface SpeechRecognitionAlternativeList {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

declare global {
  interface Window {
    SpeechRecognition?: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition?: {
      new (): SpeechRecognition;
    };
  }
}

export class WebSpeechRecognizer {
  private recognition: SpeechRecognition | null = null;
  private isListening = false;
  private state: RecognitionState = 'idle';
  private onResultCallbacks: ((result: SpeechRecognitionResult) => void)[] = [];
  private onInterimResultCallbacks: ((transcript: string) => void)[] = [];
  private onErrorCallbacks: ((error: string) => void)[] = [];
  private onEndCallbacks: (() => void)[] = [];
  private onStartCallbacks: (() => void)[] = [];
  private finalTranscript = '';

  constructor() {
    if (typeof window === 'undefined') return;

    const RecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (RecognitionClass) {
      this.recognition = new RecognitionClass();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.isListening = true;
        this.state = 'listening';
        this.onStartCallbacks.forEach((cb) => cb());
      };

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];

          if (result.isFinal) {
            const finalResult: SpeechRecognitionResult = {
              transcript: result[0].transcript,
              isFinal: true,
              confidence: result[0].confidence || 1.0,
            };

            this.finalTranscript = result[0].transcript;
            this.onResultCallbacks.forEach((cb) => cb(finalResult));
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        if (interimTranscript) {
          this.onInterimResultCallbacks.forEach((cb) => cb(this.finalTranscript + ' ' + interimTranscript));
        }
      };

      this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        this.state = 'error';
        this.isListening = false;

        let errorMsg = event.error || 'Unknown error';

        switch (event.error) {
          case 'no-speech':
            errorMsg = 'No speech detected. Please try again.';
            break;
          case 'audio-capture':
            errorMsg = 'No microphone found. Please check your audio input.';
            break;
          case 'not-allowed':
            errorMsg = 'Microphone access denied. Please allow microphone permissions.';
            break;
          case 'network':
            errorMsg = 'Network error occurred.';
            break;
          case 'aborted':
            errorMsg = 'Recording was aborted.';
            break;
        }

        this.onErrorCallbacks.forEach((cb) => cb(errorMsg));
      };

      this.recognition.onend = () => {
        this.isListening = false;

        if (this.state !== 'error') {
          this.state = 'idle';
        }

        this.onEndCallbacks.forEach((cb) => cb());
      };
    }
  }

  isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  start(options: SpeechRecognitionOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isSupported()) {
        reject(new Error('Web Speech API is not supported in this browser'));
        return;
      }

      if (this.isListening) {
        reject(new Error('Already listening'));
        return;
      }

      if (!this.recognition) {
        reject(new Error('Recognition not initialized'));
        return;
      }

      this.finalTranscript = '';
      this.state = 'listening';

      if (options.language) {
        this.recognition.lang = options.language;
      }

      if (typeof options.continuous === 'boolean') {
        this.recognition.continuous = options.continuous;
      }

      if (typeof options.interimResults === 'boolean') {
        this.recognition.interimResults = options.interimResults;
      }

      if (options.maxAlternatives) {
        this.recognition.maxAlternatives = options.maxAlternatives;
      }

      const onStartOnce = () => {
        this.onStartCallbacks = this.onStartCallbacks.filter(cb => cb !== onStartOnce);
        resolve();
      };

      const onErrorOnce = (error: string) => {
        this.onErrorCallbacks = this.onErrorCallbacks.filter(cb => cb !== onErrorOnce);
        reject(new Error(error));
      };

      this.onStartCallbacks.push(onStartOnce);
      this.onErrorCallbacks.push(onErrorOnce);

      try {
        this.recognition.start();
      } catch (error) {
        this.state = 'error';
        reject(error || new Error('Failed to start recognition'));
      }
    });
  }

  stop(): void {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  abort(): void {
    if (this.recognition && this.isListening) {
      this.recognition.abort();
      this.state = 'idle';
      this.finalTranscript = '';
    }
  }

  isCurrentlyListening(): boolean {
    return this.isListening;
  }

  getState(): RecognitionState {
    return this.state;
  }

  onResult(callback: (result: SpeechRecognitionResult) => void): void {
    this.onResultCallbacks.push(callback);
  }

  onInterimResult(callback: (transcript: string) => void): void {
    this.onInterimResultCallbacks.push(callback);
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallbacks.push(callback);
  }

  onEnd(callback: () => void): void {
    this.onEndCallbacks.push(callback);
  }

  onStart(callback: () => void): void {
    this.onStartCallbacks.push(callback);
  }

  clearCallbacks(): void {
    this.onResultCallbacks = [];
    this.onInterimResultCallbacks = [];
    this.onErrorCallbacks = [];
    this.onEndCallbacks = [];
    this.onStartCallbacks = [];
  }

  getFinalTranscript(): string {
    return this.finalTranscript;
  }
}

let recognizerInstance: WebSpeechRecognizer | null = null;

export function getWebSpeechRecognizer(): WebSpeechRecognizer {
  if (!recognizerInstance) {
    recognizerInstance = new WebSpeechRecognizer();
  }
  return recognizerInstance;
}

export function isWebRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function getAvailableLanguages(): string[] {
  if (typeof window === 'undefined' || !isWebRecognitionSupported()) {
    return ['en-US'];
  }

  const commonLanguages = [
    'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN',
    'es-ES', 'es-MX', 'es-AR', 'es-CO',
    'fr-FR', 'fr-CA', 'fr-BE',
    'de-DE', 'de-AT', 'de-CH',
    'it-IT', 'pt-BR', 'pt-PT',
    'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR',
    'ru-RU', 'ar-SA', 'hi-IN',
  ];

  return commonLanguages;
}
