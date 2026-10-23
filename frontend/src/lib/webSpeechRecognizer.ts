export interface SpeechRecognitionResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
}

/**
 * Why a capture session ended without the caller stopping it.
 */
export type SttEndOfSpeechReason = 'pause' | 'no-speech';

/**
 * Client-side endpointing budget for one capture session.
 */
export interface SttEndpointingOptions {
  /** Silence after speech, in milliseconds, that ends the session. */
  pauseMs: number;
  /** Silence from capture start, in milliseconds, before any speech is heard. */
  noSpeechTimeoutMs: number;
}

export interface SpeechRecognitionOptions {
  language?: string;
  interimResults?: boolean;
  maxAlternatives?: number;
  /** Silences after a result that stop capture. Defaults to 2000. */
  inactivityTimeoutMs?: number;
  /** Enables automatic end-of-speech reporting. Omit for tap-to-stop behavior. */
  endpointing?: SttEndpointingOptions;
  /**
   * Called at most once per session when the capture stops itself. The final
   * transcript accumulated so far is passed with it so callers do not have to
   * wait for a state update. Never called for a manual stop or abort.
   */
  onEndOfSpeech?: (reason: SttEndOfSpeechReason, finalText: string) => void;
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

const WEB_SPEECH_INACTIVITY_TIMEOUT_MS = 2000;

export function appendTranscriptSegment(current: string, segment: string): string {
  const trimmedCurrent = current.trim();
  const trimmedSegment = segment.trim();
  return trimmedCurrent ? `${trimmedCurrent} ${trimmedSegment}` : trimmedSegment;
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
  private inactivityTimeoutRef: ReturnType<typeof setTimeout> | null = null;
  private noSpeechTimeoutRef: ReturnType<typeof setTimeout> | null = null;
  private inactivityTimeoutMs = WEB_SPEECH_INACTIVITY_TIMEOUT_MS;
  private endpointing: SttEndpointingOptions | null = null;
  private endOfSpeechHandler: ((reason: SttEndOfSpeechReason, finalText: string) => void) | null = null;
  private pendingEndOfSpeechReason: SttEndOfSpeechReason | null = null;
  private endOfSpeechEmitted = false;

  private clearInactivityTimeout(): void {
    if (this.inactivityTimeoutRef !== null) {
      clearTimeout(this.inactivityTimeoutRef);
      this.inactivityTimeoutRef = null;
    }
  }

  private clearNoSpeechTimeout(): void {
    if (this.noSpeechTimeoutRef !== null) {
      clearTimeout(this.noSpeechTimeoutRef);
      this.noSpeechTimeoutRef = null;
    }
  }

  private emitEndOfSpeech(reason: SttEndOfSpeechReason): void {
    if (this.endOfSpeechEmitted) return;
    this.endOfSpeechEmitted = true;
    this.endOfSpeechHandler?.(reason, this.finalTranscript);
  }

  private scheduleNoSpeechTimeout(): void {
    this.clearNoSpeechTimeout();
    const noSpeechTimeoutMs = this.endpointing?.noSpeechTimeoutMs;

    if (!noSpeechTimeoutMs || noSpeechTimeoutMs <= 0) return;

    this.noSpeechTimeoutRef = setTimeout(() => {
      this.noSpeechTimeoutRef = null;
      if (!this.isListening || this.finalTranscript) return;
      this.emitEndOfSpeech('no-speech');
      this.stop();
    }, noSpeechTimeoutMs);
  }

  private resetInactivityTimeout(): void {
    this.clearInactivityTimeout();
    if (this.isListening) {
      this.inactivityTimeoutRef = setTimeout(() => {
        this.inactivityTimeoutRef = null;
        if (!this.isListening) return;
        if (this.endpointing) {
          this.pendingEndOfSpeechReason = 'pause';
        }
        this.stop();
      }, this.inactivityTimeoutMs);
    }
  }

  constructor() {
    if (typeof window === 'undefined') return;

    const RecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (RecognitionClass) {
      this.recognition = new RecognitionClass();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.isListening = true;
        this.state = 'listening';
        this.scheduleNoSpeechTimeout();
        this.onStartCallbacks.forEach((cb) => cb());
      };

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        this.clearNoSpeechTimeout();
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];

          if (result.isFinal) {
            const segment = result[0].transcript;
            this.finalTranscript = appendTranscriptSegment(this.finalTranscript, segment);

            const finalResult: SpeechRecognitionResult = {
              transcript: segment,
              isFinal: true,
              confidence: result[0].confidence || 1.0,
            };

            this.onResultCallbacks.forEach((cb) => cb(finalResult));
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        if (interimTranscript) {
          this.onInterimResultCallbacks.forEach((cb) => cb(this.finalTranscript + ' ' + interimTranscript));
        }

        this.resetInactivityTimeout();
      };

      this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        this.clearInactivityTimeout();
        this.clearNoSpeechTimeout();
        this.state = 'error';
        this.isListening = false;
        this.pendingEndOfSpeechReason = null;

        if (this.endpointing && event.error === 'no-speech') {
          this.emitEndOfSpeech('no-speech');
          this.endpointing = null;
          this.endOfSpeechHandler = null;
          return;
        }

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
        this.clearInactivityTimeout();
        this.clearNoSpeechTimeout();
        this.isListening = false;
        this.state = 'idle';

        const reason = this.pendingEndOfSpeechReason;
        this.pendingEndOfSpeechReason = null;
        this.endpointing = null;

        if (reason) {
          this.emitEndOfSpeech(reason);
        }
        this.endOfSpeechHandler = null;

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
      this.clearInactivityTimeout();
      this.clearNoSpeechTimeout();
      this.inactivityTimeoutMs =
        options.inactivityTimeoutMs ?? options.endpointing?.pauseMs ?? WEB_SPEECH_INACTIVITY_TIMEOUT_MS;
      this.endpointing = options.endpointing ?? null;
      this.endOfSpeechHandler = options.onEndOfSpeech ?? null;
      this.pendingEndOfSpeechReason = null;
      this.endOfSpeechEmitted = false;

      if (options.language) {
        this.recognition.lang = options.language;
      }

      if (typeof options.interimResults === 'boolean') {
        this.recognition.interimResults = options.interimResults;
      }

      if (options.maxAlternatives) {
        this.recognition.maxAlternatives = options.maxAlternatives;
      }

      let settled = false;

      const cleanup = () => {
        settled = true;
        this.onStartCallbacks = this.onStartCallbacks.filter(cb => cb !== onStartOnce);
        this.onErrorCallbacks = this.onErrorCallbacks.filter(cb => cb !== onErrorOnce);
      };

      const onStartOnce = () => {
        if (settled) return;
        cleanup();
        resolve();
      };

      const onErrorOnce = (error: string) => {
        if (settled) return;
        cleanup();
        reject(new Error(error));
      };

      this.onStartCallbacks.push(onStartOnce);
      this.onErrorCallbacks.push(onErrorOnce);

      try {
        this.recognition.start();
      } catch (error) {
        this.state = 'error';
        this.onStartCallbacks = this.onStartCallbacks.filter(cb => cb !== onStartOnce);
        this.onErrorCallbacks = this.onErrorCallbacks.filter(cb => cb !== onErrorOnce);
        reject(error || new Error('Failed to start recognition'));
      }
    });
  }

  stop(): void {
    this.clearInactivityTimeout();
    this.clearNoSpeechTimeout();
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        this.isListening = false;
        this.state = 'idle';
      }
    }
  }

  abort(): void {
    this.clearInactivityTimeout();
    this.clearNoSpeechTimeout();
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        this.state = 'idle';
        this.isListening = false;
      }
    }
    this.state = 'idle';
    this.isListening = false;
    this.finalTranscript = '';
    this.endpointing = null;
    this.endOfSpeechHandler = null;
    this.pendingEndOfSpeechReason = null;
    this.endOfSpeechEmitted = true;
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
    this.clearInactivityTimeout();
    this.clearNoSpeechTimeout();
    this.endpointing = null;
    this.endOfSpeechHandler = null;
    this.pendingEndOfSpeechReason = null;
    this.endOfSpeechEmitted = true;
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
