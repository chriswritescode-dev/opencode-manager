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
const MAX_TRANSPARENT_RESTARTS = 5;
const MIN_RESTART_SESSION_MS = 250;
const RESTART_FAILED_MESSAGE = 'Speech recognition stopped unexpectedly. Please try again.';

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
  private interimTranscript = '';
  private inactivityTimeoutRef: ReturnType<typeof setTimeout> | null = null;
  private noSpeechTimeoutRef: ReturnType<typeof setTimeout> | null = null;
  private noSpeechDeadlineAt: number | null = null;
  private inactivityTimeoutMs = WEB_SPEECH_INACTIVITY_TIMEOUT_MS;
  private endpointing: SttEndpointingOptions | null = null;
  private endOfSpeechHandler: ((reason: SttEndOfSpeechReason, finalText: string) => void) | null = null;
  private pendingEndOfSpeechReason: SttEndOfSpeechReason | null = null;
  private endOfSpeechEmitted = false;
  private restartCount = 0;
  private restartStartedAt = 0;
  private sessionHadSpeech = false;
  private awaitingRestart = false;
  private stopRequested = false;
  private fatalErrorRaised = false;
  private suppressStartCallbacks = false;

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

  private accumulatedTranscript(): string {
    const interim = this.interimTranscript.trim();
    return interim ? appendTranscriptSegment(this.finalTranscript, interim) : this.finalTranscript;
  }

  private emitEndOfSpeech(reason: SttEndOfSpeechReason): void {
    if (this.endOfSpeechEmitted) return;
    this.endOfSpeechEmitted = true;
    this.endOfSpeechHandler?.(reason, this.accumulatedTranscript());
  }

  private hasNoSpeechBudgetRemaining(): boolean {
    return this.noSpeechDeadlineAt !== null && Date.now() < this.noSpeechDeadlineAt;
  }

  private scheduleNoSpeechTimeout(): void {
    this.clearNoSpeechTimeout();

    if (this.noSpeechDeadlineAt === null) return;

    const remainingMs = Math.max(0, this.noSpeechDeadlineAt - Date.now());

    this.noSpeechTimeoutRef = setTimeout(() => {
      this.noSpeechTimeoutRef = null;
      if (this.endOfSpeechEmitted || this.finalTranscript) return;
      if (!this.isListening && !this.awaitingRestart) return;
      this.emitEndOfSpeech('no-speech');
      this.stop();
    }, remainingMs);
  }

  private canRestartCapture(): boolean {
    if (this.endOfSpeechEmitted) return false;
    if (this.restartCount >= MAX_TRANSPARENT_RESTARTS) return false;

    const endedTooSoon =
      this.restartCount > 0 &&
      !this.sessionHadSpeech &&
      Date.now() - this.restartStartedAt < MIN_RESTART_SESSION_MS;

    return !endedTooSoon;
  }

  private restartCapture(): 'restarted' | 'blocked' | 'failed' {
    if (!this.recognition || !this.canRestartCapture()) return 'blocked';

    this.restartCount += 1;
    this.restartStartedAt = Date.now();
    this.isListening = true;
    this.state = 'listening';
    this.awaitingRestart = false;
    this.stopRequested = false;
    this.fatalErrorRaised = false;
    this.sessionHadSpeech = false;
    this.suppressStartCallbacks = true;

    try {
      this.recognition.start();
      return 'restarted';
    } catch {
      this.suppressStartCallbacks = false;
      this.isListening = false;
      this.endpointing = null;
      this.endOfSpeechHandler = null;
      this.endOfSpeechEmitted = true;
      this.onErrorCallbacks.forEach((cb) => cb(RESTART_FAILED_MESSAGE));
      return 'failed';
    }
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
        this.sessionHadSpeech = false;
        this.scheduleNoSpeechTimeout();

        if (this.suppressStartCallbacks) {
          this.suppressStartCallbacks = false;
          return;
        }

        this.onStartCallbacks.forEach((cb) => cb());
      };

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        this.clearNoSpeechTimeout();
        this.sessionHadSpeech = true;
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

        this.interimTranscript = interimTranscript;

        if (interimTranscript) {
          this.onInterimResultCallbacks.forEach((cb) => cb(this.finalTranscript + ' ' + interimTranscript));
        }

        this.resetInactivityTimeout();
      };

      this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        this.clearInactivityTimeout();

        if (this.endpointing && event.error === 'no-speech') {
          if (this.hasNoSpeechBudgetRemaining() && !this.endOfSpeechEmitted) {
            this.awaitingRestart = true;
            this.isListening = false;
            return;
          }

          this.fatalErrorRaised = true;
          this.clearNoSpeechTimeout();
          this.state = 'error';
          this.isListening = false;
          this.pendingEndOfSpeechReason = null;
          this.emitEndOfSpeech('no-speech');
          this.endpointing = null;
          this.endOfSpeechHandler = null;
          return;
        }

        this.clearNoSpeechTimeout();
        this.state = 'error';
        this.isListening = false;
        this.pendingEndOfSpeechReason = null;
        this.fatalErrorRaised = true;

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

        const reason = this.pendingEndOfSpeechReason;
        this.pendingEndOfSpeechReason = null;

        if (reason) {
          this.emitEndOfSpeech(reason);
        } else if (this.endpointing && !this.stopRequested && !this.fatalErrorRaised) {
          if (this.awaitingRestart) {
            const outcome = this.hasNoSpeechBudgetRemaining() ? this.restartCapture() : 'blocked';
            if (outcome === 'restarted') return;
            if (outcome === 'blocked') this.emitEndOfSpeech('no-speech');
          } else if (this.accumulatedTranscript()) {
            this.emitEndOfSpeech('pause');
          } else if (this.hasNoSpeechBudgetRemaining()) {
            const outcome = this.restartCapture();
            if (outcome === 'restarted') return;
            if (outcome === 'blocked') this.emitEndOfSpeech('no-speech');
          } else {
            this.emitEndOfSpeech('no-speech');
          }
        }

        this.clearNoSpeechTimeout();
        this.isListening = false;
        this.state = 'idle';
        this.endpointing = null;
        this.endOfSpeechHandler = null;
        this.awaitingRestart = false;
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
      this.interimTranscript = '';
      this.state = 'listening';
      this.clearInactivityTimeout();
      this.clearNoSpeechTimeout();
      this.inactivityTimeoutMs =
        options.inactivityTimeoutMs ?? options.endpointing?.pauseMs ?? WEB_SPEECH_INACTIVITY_TIMEOUT_MS;
      this.endpointing = options.endpointing ?? null;
      this.endOfSpeechHandler = options.onEndOfSpeech ?? null;
      this.pendingEndOfSpeechReason = null;
      this.endOfSpeechEmitted = false;
      this.restartCount = 0;
      this.restartStartedAt = 0;
      this.sessionHadSpeech = false;
      this.awaitingRestart = false;
      this.stopRequested = false;
      this.fatalErrorRaised = false;
      this.suppressStartCallbacks = false;

      const noSpeechTimeoutMs = this.endpointing?.noSpeechTimeoutMs ?? 0;
      this.noSpeechDeadlineAt = noSpeechTimeoutMs > 0 ? Date.now() + noSpeechTimeoutMs : null;

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
    this.stopRequested = true;
    this.awaitingRestart = false;
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
    this.stopRequested = true;
    this.awaitingRestart = false;
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
    this.interimTranscript = '';
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
    this.noSpeechDeadlineAt = null;
    this.awaitingRestart = false;
    this.suppressStartCallbacks = false;
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
