import { vi } from 'vitest'
import { act } from '@testing-library/react'
import { encode } from 'uqr'
import type { JsonValue } from '@opencode-manager/shared/utils'

type ChangeListener = (event: MediaQueryListEvent) => void

class FakeMediaQueryListEvent extends Event {
  readonly matches: boolean
  readonly media: string

  constructor(type: string, init: MediaQueryListEventInit = {}) {
    super(type)
    this.matches = init.matches ?? false
    this.media = init.media ?? ''
  }
}

const restorers: Array<() => void> = []

function registerRestore(restore: () => void): void {
  restorers.push(restore)
}

export function restoreBrowserFakes(): void {
  while (restorers.length > 0) {
    restorers.pop()?.()
  }
}

export interface MatchMediaFake {
  mediaQueryList: {
    matches: boolean
    media: string
    addEventListener: (type: string, listener: ChangeListener) => void
    removeEventListener: (type: string, listener: ChangeListener) => void
  }
  setMatches: (matches: boolean) => void
  listeners: Set<ChangeListener>
}

export function installMatchMedia(initialMatches = false): MatchMediaFake {
  const listeners = new Set<ChangeListener>()
  const mediaQueryList = {
    matches: initialMatches,
    media: '',
    addEventListener: (_type: string, listener: ChangeListener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: ChangeListener) => {
      listeners.delete(listener)
    },
    addListener: (listener: ChangeListener) => {
      listeners.add(listener)
    },
    removeListener: (listener: ChangeListener) => {
      listeners.delete(listener)
    },
  }

  vi.stubGlobal('matchMedia', () => mediaQueryList)

  return {
    mediaQueryList,
    listeners,
    setMatches: (next) => {
      mediaQueryList.matches = next
      listeners.forEach((listener) => listener(new FakeMediaQueryListEvent('change', { matches: next })))
    },
  }
}

export interface SpeechSynthesisVoiceFake {
  name: string
  lang: string
  default: boolean
  localService: boolean
  voiceURI: string
}

export interface SpeechSynthesisFake {
  speak: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  getVoices: () => SpeechSynthesisVoiceFake[]
  spoken: Array<{ text: string }>
  completeSpeech: () => void
}

export function installSpeechSynthesis(voiceNames: readonly string[] = ['Test Voice']): SpeechSynthesisFake {
  const spoken: Array<{ text: string }> = []
  const pendingUtterances: Array<{
    text: string
    onend: (() => void) | null
    onerror: ((event: { error: string }) => void) | null
  }> = []
  const voices: SpeechSynthesisVoiceFake[] = voiceNames.map((name) => ({
    name,
    lang: 'en-US',
    default: name === voiceNames[0],
    localService: true,
    voiceURI: name,
  }))
  const speak = vi.fn((utterance: {
    text: string
    onend: (() => void) | null
    onerror: ((event: { error: string }) => void) | null
  }) => {
    spoken.push({ text: utterance.text })
    pendingUtterances.push(utterance)
  })
  const synthesis = {
    speak,
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    speaking: false,
    pending: false,
    paused: false,
  }

  class FakeSpeechSynthesisUtterance {
    text: string
    voice: SpeechSynthesisVoiceFake | null = null
    lang = ''
    rate = 1
    pitch = 1
    volume = 1
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: ((event: { error: string }) => void) | null = null
    onboundary: ((event: { name: string, charIndex: number, charLength?: number }) => void) | null = null

    constructor(text: string) {
      this.text = text
    }
  }

  vi.stubGlobal('speechSynthesis', synthesis)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance)
  return {
    ...synthesis,
    spoken,
    completeSpeech: () => {
      const utterance = pendingUtterances.shift()
      utterance?.onend?.()
    },
  }
}

export interface FakeSpeechRecognitionResult {
  transcript: string
  confidence: number
}

export interface SpeechRecognitionAlternativeListLike extends ArrayLike<FakeSpeechRecognitionResult> {
  isFinal: boolean
  length: number
}

export interface SpeechRecognitionResultEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionAlternativeListLike>
}

export interface SpeechRecognitionFakeInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onstart: ((event: Event) => void) | null
  onend: ((event: Event) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

export const SPEECH_RECOGNITION_GLOBAL = 'SpeechRecognition'

export function installSpeechRecognition() {
  const instances: SpeechRecognitionFakeInstance[] = []

  class FakeSpeechRecognition implements SpeechRecognitionFakeInstance {
    continuous = false
    interimResults = false
    lang = ''
    maxAlternatives = 1
    onstart: ((event: Event) => void) | null = null
    onend: ((event: Event) => void) | null = null
    onerror: ((event: { error: string }) => void) | null = null
    onresult: ((event: SpeechRecognitionResultEventLike) => void) | null = null
    start = vi.fn(() => {
      setTimeout(() => this.onstart?.(new Event('start')), 0)
    })
    stop = vi.fn()
    abort = vi.fn()

    constructor() {
      instances.push(this)
    }
  }

  vi.stubGlobal(SPEECH_RECOGNITION_GLOBAL, FakeSpeechRecognition)
  vi.stubGlobal('webkitSpeechRecognition', FakeSpeechRecognition)

  const emitResult = (instance: SpeechRecognitionFakeInstance, transcript: string, isFinal: boolean): void => {
    instance.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript, confidence: 1 }, isFinal, length: 1 }],
    })
  }

  return { instances, emitResult }
}

export interface AudioFake {
  src: string
  currentTime: number
  duration: number
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
  removeAttribute: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  dispatch: (type: string) => void
}

export function installAudio(): AudioFake {
  const listeners = new Map<string, Set<() => void>>()
  const instance: AudioFake = {
    src: '',
    currentTime: 0,
    duration: 1,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(type, set)
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener)
    }),
    dispatch: (type) => {
      listeners.get(type)?.forEach((listener) => listener())
    },
  }

  vi.stubGlobal('Audio', class {
    static instance = instance
    src = ''
    currentTime = 0
    duration = 1
    play = instance.play
    pause = instance.pause
    load = instance.load
    removeAttribute = instance.removeAttribute
    addEventListener = instance.addEventListener
    removeEventListener = instance.removeEventListener

    constructor(src?: string) {
      if (src !== undefined) this.src = src
      instance.src = src ?? ''
    }
  })

  return instance
}

export interface ClipboardFake {
  writeText: ReturnType<typeof vi.fn>
  readText: ReturnType<typeof vi.fn>
}

export function installClipboard(text = ''): ClipboardFake {
  const clipboard = {
    writeText: vi.fn(async () => undefined),
    readText: vi.fn(async () => text),
  }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
  registerRestore(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  })
  return clipboard
}

export function installWindowSize(width: number, height = 768): void {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  registerRestore(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: originalHeight })
  })
}

export function installVisualViewport() {
  const listeners = new Set<() => void>()
  const viewport = {
    width: 1024,
    height: 768,
    offsetTop: 0,
    offsetLeft: 0,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'resize') listeners.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'resize') listeners.delete(listener)
    }),
    dispatchResize: () => listeners.forEach((listener) => listener()),
  }
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  registerRestore(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
  })
  return viewport
}

export function installNotification(permission: 'default' | 'denied' | 'granted' = 'granted') {
  const FakeNotification = class {
    static permission = permission
    static requestPermission = vi.fn(async () => permission)
  }
  vi.stubGlobal('Notification', FakeNotification)
  return { permission, requestPermission: FakeNotification.requestPermission }
}

export function installServiceWorker() {
  const listeners = new Set<(event: { data: JsonValue }) => void>()
  const registrations: Array<{ unregister: ReturnType<typeof vi.fn> }> = []
  const serviceWorker = {
    controller: null,
    addEventListener: (type: string, listener: (event: { data: JsonValue }) => void) => {
      if (type === 'message') listeners.add(listener)
    },
    removeEventListener: (type: string, listener: (event: { data: JsonValue }) => void) => {
      if (type === 'message') listeners.delete(listener)
    },
    getRegistration: vi.fn(async () => undefined),
    getRegistrations: vi.fn(async () => registrations),
    register: vi.fn(async () => ({ unregister: vi.fn() })),
    ready: Promise.resolve({}),
  }
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })
  registerRestore(() => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
  })
  return {
    listeners,
    registrations,
    dispatchMessage: (data: JsonValue) => listeners.forEach((listener) => listener({ data })),
  }
}

export function installObjectUrl() {
  const createObjectURL = vi.fn(() => 'blob:test-object-url')
  const revokeObjectURL = vi.fn()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  registerRestore(() => {
    URL.createObjectURL = () => 'blob:test-object-url'
    URL.revokeObjectURL = () => undefined
  })
  return { createObjectURL, revokeObjectURL }
}

export interface MediaRecorderFakeInstance {
  mimeType: string
  state: 'inactive' | 'recording' | 'paused'
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

export function installAudioRecorder() {
  const instances: MediaRecorderFakeInstance[] = []

  class FakeMediaRecorder implements MediaRecorderFakeInstance {
    static isTypeSupported = () => true
    mimeType = 'audio/webm'
    state: 'inactive' | 'recording' | 'paused' = 'inactive'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    onerror: (() => void) | null = null
    start = vi.fn(() => {
      this.state = 'recording'
    })
    stop = vi.fn(() => {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) })
      this.onstop?.()
    })

    constructor() {
      instances.push(this)
    }
  }

  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  registerRestore(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  })
  return { instances, getUserMedia }
}

export interface ElementScrollMetrics {
  scrollHeight: number
  clientHeight: number
}

export interface ElementScrollMetricsFake {
  metrics: ElementScrollMetrics
  setMetrics: (next: Partial<ElementScrollMetrics>) => void
  getScrollTop: (element: Element) => number
  setScrollTop: (element: Element, top: number) => void
}

export function installElementScrollMetrics(initial: Partial<ElementScrollMetrics> = {}): ElementScrollMetricsFake {
  const metrics: ElementScrollMetrics = { scrollHeight: 0, clientHeight: 0, ...initial }
  const scrollPositions = new WeakMap<Element, number>()
  const properties = ['scrollHeight', 'clientHeight', 'scrollTop', 'scrollBy'] as const
  const originals = properties.map((property) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, property))

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => metrics.clientHeight })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return scrollPositions.get(this) ?? 0
    },
    set(this: Element, value: number) {
      scrollPositions.set(this, value)
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
    configurable: true,
    writable: true,
    value: function scrollBy(this: Element, options?: ScrollToOptions) {
      scrollPositions.set(this, (scrollPositions.get(this) ?? 0) + (options?.top ?? 0))
    },
  })

  registerRestore(() => {
    properties.forEach((property, index) => {
      const original = originals[index]
      if (original) {
        Object.defineProperty(HTMLElement.prototype, property, original)
        return
      }
      Reflect.deleteProperty(HTMLElement.prototype, property)
    })
  })

  return {
    metrics,
    setMetrics: (next) => {
      Object.assign(metrics, next)
    },
    getScrollTop: (element) => scrollPositions.get(element) ?? 0,
    setScrollTop: (element, top) => {
      scrollPositions.set(element, top)
    },
  }
}

export interface ResizeObserverFake {
  observedElements: () => Element[]
  reportHeight: (height: number) => void
}

function resizeObserverEntry(target: Element, height: number): ResizeObserverEntry {
  const contentRect: DOMRectReadOnly = {
    x: 0,
    y: 0,
    width: 0,
    height,
    top: 0,
    right: 0,
    bottom: height,
    left: 0,
    toJSON: () => ({ x: 0, y: 0, width: 0, height, top: 0, right: 0, bottom: height, left: 0 }),
  }
  const size: ResizeObserverSize = { blockSize: height, inlineSize: 0 }
  return {
    target,
    contentRect,
    borderBoxSize: [size],
    contentBoxSize: [size],
    devicePixelContentBoxSize: [size],
  }
}

export function installResizeObserver(): ResizeObserverFake {
  const observations: Array<{ element: Element, callback: ResizeObserverCallback, observer: ResizeObserver }> = []

  class FakeResizeObserver implements ResizeObserver {
    private readonly callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe(element: Element) {
      observations.push({ element, callback: this.callback, observer: this })
    }

    unobserve(element: Element) {
      const index = observations.findIndex((entry) => entry.observer === this && entry.element === element)
      if (index !== -1) observations.splice(index, 1)
    }

    disconnect() {
      for (let index = observations.length - 1; index >= 0; index -= 1) {
        if (observations[index].observer === this) observations.splice(index, 1)
      }
    }
  }

  vi.stubGlobal('ResizeObserver', FakeResizeObserver)

  return {
    observedElements: () => observations.flatMap((entry) => (entry.element.isConnected ? [entry.element] : [])),
    reportHeight: (height) => {
      act(() => {
        for (const entry of [...observations]) {
          if (!entry.element.isConnected) continue
          entry.callback([resizeObserverEntry(entry.element, height)], entry.observer)
        }
      })
    },
  }
}

const QR_SCAN_MODULE_PX = 4
function buildQrPixels(text: string) {
  const qr = encode(text, { ecc: 'M' as const, border: 4 })
  const width = qr.size * QR_SCAN_MODULE_PX
  const data = new Uint8ClampedArray(width * width * 4)
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dark = qr.data[Math.floor(y / QR_SCAN_MODULE_PX)][Math.floor(x / QR_SCAN_MODULE_PX)]
      const offset = (y * width + x) * 4
      const value = dark ? 0 : 255
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }
  return { data, width, height: width }
}

function emulateBrowserTargets(pixels: { data: Uint8ClampedArray, width: number, height: number }) {
  const contextStub = {
    drawImage: () => undefined,
    getImageData: () => pixels,
  }
  const targets = [
    { target: window, property: 'isSecureContext', descriptor: { configurable: true, value: true } },
    {
      target: HTMLCanvasElement.prototype,
      property: 'getContext',
      descriptor: { configurable: true, value: () => contextStub },
    },
    {
      target: HTMLMediaElement.prototype,
      property: 'play',
      descriptor: { configurable: true, value: () => Promise.resolve() },
    },
    {
      target: HTMLMediaElement.prototype,
      property: 'readyState',
      descriptor: { configurable: true, get: () => 4 },
    },
    {
      target: HTMLVideoElement.prototype,
      property: 'videoWidth',
      descriptor: { configurable: true, get: () => pixels.width },
    },
    {
      target: HTMLVideoElement.prototype,
      property: 'videoHeight',
      descriptor: { configurable: true, get: () => pixels.height },
    },
  ]

  targets.forEach(({ target, property, descriptor }) => {
    const original = Object.getOwnPropertyDescriptor(target, property)
    Object.defineProperty(target, property, descriptor)
    registerRestore(() => {
      if (original) {
        Object.defineProperty(target, property, original)
        return
      }
      Reflect.deleteProperty(target, property)
    })
  })
}

export interface QrScannerFake {
  scan: () => Promise<void>
  cameraStartCount: () => number
}

export function installQrScanner(qrText: string): QrScannerFake {
  const pixels = buildQrPixels(qrText)
  const frameQueue: FrameRequestCallback[] = []
  let nextFrameId = 1
  let timestamp = 0
  let cameraStarts = 0

  emulateBrowserTargets(pixels)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameQueue.push(callback)
    const id = nextFrameId
    nextFrameId += 1
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => {
        cameraStarts += 1
        return { getTracks: () => [{ stop: () => undefined }] }
      },
    },
  })
  registerRestore(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  })

  return {
    cameraStartCount: () => cameraStarts,
    scan: async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (frameQueue.length === 0) {
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
          })
          if (frameQueue.length === 0) continue
        }
        const callback = frameQueue.shift()
        timestamp += 120
        await act(async () => {
          callback?.(timestamp)
        })
        if (frameQueue.length === 0) return
      }
    },
  }
}

export interface PasskeyAuthenticatorFake {
  credentialRequestCount: number
}

export function installPasskeyAuthenticator(): PasskeyAuthenticatorFake {
  const state: PasskeyAuthenticatorFake = { credentialRequestCount: 0 }
  const assertion = {
    id: 'cred_test',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    response: {
      authenticatorData: new Uint8Array([1]).buffer,
      clientDataJSON: new Uint8Array([2]).buffer,
      signature: new Uint8Array([3]).buffer,
      userHandle: new Uint8Array([4]).buffer,
    },
    getClientExtensionResults: () => ({}),
    authenticatorAttachment: 'platform',
  }
  const get = vi.fn(async () => {
    state.credentialRequestCount += 1
    return assertion
  })
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get, create: vi.fn() } })
  registerRestore(() => {
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: undefined })
  })
  vi.stubGlobal(
    'PublicKeyCredential',
    class {
      static isUserVerifyingPlatformAuthenticatorAvailable = async () => true
    },
  )
  return state
}

export interface PushSubscriptionFake {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export function installServiceWorkerPushSubscription(): PushSubscriptionFake {
  const subscription: PushSubscriptionFake = {
    endpoint: 'https://push.example.com/subscription',
    keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => ({ toJSON: () => subscription }),
        },
      }),
    },
  })
  registerRestore(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getRegistration: async () => undefined,
      },
    })
  })
  return subscription
}

export function installServiceWorkerWithoutPushSubscription(): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => null,
        },
      }),
    },
  })
  registerRestore(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getRegistration: async () => undefined,
      },
    })
  })
}

export class NavigationRequest {
  url: string
  method: string
  headers: Headers
  signal: AbortSignal

  constructor(input: string | URL, init: RequestInit = {}) {
    this.url = input.toString()
    this.method = init.method ?? 'GET'
    this.headers = new Headers(init.headers)
    this.signal = new AbortController().signal
  }
}

export function installNavigationRequest(): void {
  vi.stubGlobal('Request', NavigationRequest)
}

export function installPointerCapture(): void {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
}

export interface TouchPointInit {
  clientX: number
  clientY: number
  identifier?: number
}

type TouchEventType = 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel'

let touchInstalled = false

export function installTouch(): void {
  if (touchInstalled) return

  class FakeTouch implements Touch {
    identifier: number
    target: EventTarget
    clientX: number
    clientY: number
    screenX: number
    screenY: number
    pageX: number
    pageY: number
    radiusX = 0
    radiusY = 0
    rotationAngle = 0
    force = 1
    altitudeAngle = Math.PI / 2

    constructor(init: TouchInit) {
      this.identifier = init.identifier
      this.target = init.target
      this.clientX = init.clientX ?? 0
      this.clientY = init.clientY ?? 0
      this.screenX = this.clientX
      this.screenY = this.clientY
      this.pageX = this.clientX
      this.pageY = this.clientY
    }
  }

  vi.stubGlobal('Touch', FakeTouch)
  touchInstalled = true
  registerRestore(() => {
    touchInstalled = false
  })
}

function toTouch(point: TouchPointInit, target: EventTarget): Touch {
  return new Touch({
    identifier: point.identifier ?? 0,
    target,
    clientX: point.clientX,
    clientY: point.clientY,
  })
}

export function createTouchEvent(
  type: TouchEventType,
  touches: readonly TouchPointInit[],
  changedTouches: readonly TouchPointInit[] = touches,
): TouchEvent {
  installTouch()
  const target = document.body
  return new TouchEvent(type, {
    touches: touches.map((point) => toTouch(point, target)),
    targetTouches: touches.map((point) => toTouch(point, target)),
    changedTouches: changedTouches.map((point) => toTouch(point, target)),
    bubbles: true,
    cancelable: true,
  })
}

export interface WebSocketFakeConnection {
  url: string
  binaryType: string
  readyState: number
  sent: string[]
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  send: (data: string) => void
  close: () => void
  open: () => void
  message: (data: string | ArrayBuffer) => void
  serverClose: (code: number) => void
}

export interface WebSocketFake {
  instances: WebSocketFakeConnection[]
  connectionFor: (urlFragment: string) => WebSocketFakeConnection | undefined
}

export function installWebSocket(): WebSocketFake {
  const instances: WebSocketFakeConnection[] = []

  class FakeWebSocket implements WebSocketFakeConnection {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    url: string
    binaryType = 'blob'
    readyState = FakeWebSocket.CONNECTING
    sent: string[] = []
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null

    constructor(url: string) {
      this.url = url
      instances.push(this)
    }

    send(data: string) {
      this.sent.push(data)
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED
    }

    open() {
      this.readyState = FakeWebSocket.OPEN
      this.onopen?.(new Event('open'))
    }

    message(data: string | ArrayBuffer) {
      this.onmessage?.(new MessageEvent('message', { data }))
    }

    serverClose(code: number) {
      this.readyState = FakeWebSocket.CLOSED
      this.onclose?.(new CloseEvent('close', { code }))
    }
  }

  vi.stubGlobal('WebSocket', FakeWebSocket)

  return {
    instances,
    connectionFor: (urlFragment) => instances.find((instance) => instance.url.includes(urlFragment)),
  }
}
