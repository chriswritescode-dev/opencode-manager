import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
})

Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

Object.defineProperty(globalThis, 'speechSynthesis', {
  writable: true,
  value: {
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn().mockReturnValue([]),
    onvoiceschanged: null,
    speaking: false,
    pending: false,
    paused: false,
  },
})

Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
  writable: true,
  value: vi.fn().mockImplementation((text) => ({
    text,
    lang: '',
    voice: null,
    volume: 1,
    rate: 1,
    pitch: 1,
    onstart: null,
    onend: null,
    onerror: null,
    onpause: null,
    onresume: null,
    onmark: null,
    onboundary: null,
  })),
})

class MockFileReader {
  result: string | ArrayBuffer | null = null
  onloadend: (() => void) | null = null
  onerror: ((error: Error) => void) | null = null

  readAsDataURL(blob: Blob) {
    setTimeout(() => {
      this.result = `data:${blob.type};base64,dGVzdA==`
      this.onloadend?.()
    }, 0)
  }
}

Object.defineProperty(globalThis, 'FileReader', {
  writable: true,
  value: MockFileReader,
})

class MockBlob {
  private parts: BlobPart[]
  type: string
  size: number

  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    this.parts = parts || []
    this.type = options?.type || ''
    this.size = this.parts.reduce((acc, part) => {
      if (part instanceof ArrayBuffer) return acc + part.byteLength
      if (typeof part === 'string') return acc + part.length
      return acc
    }, 0)
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const totalSize = this.parts.reduce((acc, part) => {
      if (part instanceof ArrayBuffer) return acc + part.byteLength
      if (typeof part === 'string') return acc + new TextEncoder().encode(part).length
      return acc
    }, 0)

    const buffer = new ArrayBuffer(totalSize)
    const view = new Uint8Array(buffer)
    let offset = 0

    for (const part of this.parts) {
      if (part instanceof ArrayBuffer) {
        view.set(new Uint8Array(part), offset)
        offset += part.byteLength
      } else if (typeof part === 'string') {
        const encoded = new TextEncoder().encode(part)
        view.set(encoded, offset)
        offset += encoded.length
      }
    }

    return buffer
  }
}

Object.defineProperty(globalThis, 'Blob', {
  writable: true,
  value: MockBlob,
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: vi.fn().mockReturnValue({
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
    }),
  }
})
