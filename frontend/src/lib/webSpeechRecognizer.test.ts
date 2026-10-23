import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSpeechRecognizer } from './webSpeechRecognizer'

interface FakeSpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onstart: ((event: Event) => void) | null
  onend: ((event: Event) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: Record<string, unknown>) => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

function createFakeSpeechRecognition(): FakeSpeechRecognition {
  return {
    continuous: false,
    interimResults: false,
    lang: '',
    maxAlternatives: 1,
    onstart: null,
    onend: null,
    onerror: null,
    onresult: null,
    start: vi.fn(function (this: FakeSpeechRecognition) {
      setTimeout(() => {
        if (this.onstart) this.onstart(new Event('start'))
      }, 0)
    }),
    stop: vi.fn(),
    abort: vi.fn(),
  }
}

function makeResultEvent(
  resultIndex: number,
  resultsLength: number,
  entries: Array<{
    isFinal: boolean
    transcript: string
    confidence: number
  }>,
): Record<string, unknown> {
  const results: Record<number, Record<string, unknown>> = {}
  for (let i = 0; i < entries.length; i++) {
    results[i] = {
      isFinal: entries[i].isFinal,
      0: { transcript: entries[i].transcript, confidence: entries[i].confidence },
    }
  }
  return {
    resultIndex,
    results: { ...results, length: resultsLength },
  }
}

describe('WebSpeechRecognizer', () => {
  let fakeRec: FakeSpeechRecognition

  beforeEach(() => {
    fakeRec = createFakeSpeechRecognition()
    ;(window as any).SpeechRecognition = vi.fn(() => fakeRec)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as any).SpeechRecognition
  })

  it('configures continuous=true, interimResults=true, maxAlternatives=1, and lang on start()', async () => {
    const rec = new WebSpeechRecognizer()
    await rec.start({ language: 'en-US', interimResults: true, maxAlternatives: 1 })

    expect(fakeRec.continuous).toBe(true)
    expect(fakeRec.interimResults).toBe(true)
    expect(fakeRec.maxAlternatives).toBe(1)
    expect(fakeRec.lang).toBe('en-US')
  })

  it('appends multiple final result segments instead of replacing', async () => {
    const rec = new WebSpeechRecognizer()
    const results: Array<{ transcript: string; isFinal: boolean; confidence: number }> = []
    rec.onResult((r) => results.push(r))
    await rec.start()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'hello', confidence: 0.9 },
    ]))

    fakeRec.onresult!(makeResultEvent(1, 2, [
      { isFinal: false, transcript: 'hello', confidence: 0.9 },
      { isFinal: true, transcript: 'world', confidence: 0.8 },
    ]))

    expect(rec.getFinalTranscript()).toBe('hello world')
    expect(results).toHaveLength(2)
    expect(results[0].transcript).toBe('hello')
    expect(results[1].transcript).toBe('world')
  })

  it('emits combined final+interim transcript on interim events', async () => {
    const rec = new WebSpeechRecognizer()
    const interims: string[] = []
    rec.onInterimResult((t) => interims.push(t))
    await rec.start()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'hello', confidence: 0.9 },
    ]))

    fakeRec.onresult!(makeResultEvent(1, 2, [
      { isFinal: true, transcript: 'hello', confidence: 0.9 },
      { isFinal: false, transcript: 'world', confidence: 0.0 },
    ]))

    expect(interims).toHaveLength(1)
    expect(interims[0]).toBe('hello world')
  })

  it('calls native stop after 2 seconds of inactivity following a result', async () => {
    const rec = new WebSpeechRecognizer()
    await rec.start()

    vi.useFakeTimers()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'test', confidence: 1.0 },
    ]))

    expect(fakeRec.stop).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2000)

    expect(fakeRec.stop).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('abort() clears accumulated transcript and inactivity timer', async () => {
    const rec = new WebSpeechRecognizer()
    await rec.start()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'hello', confidence: 0.9 },
    ]))

    expect(rec.getFinalTranscript()).toBe('hello')

    rec.abort()
    expect(rec.getFinalTranscript()).toBe('')
    expect(fakeRec.abort).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    vi.advanceTimersByTime(2000)
    expect(fakeRec.stop).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('onend clears inactivity timer and sets state to idle', async () => {
    const rec = new WebSpeechRecognizer()
    const onEnd = vi.fn()
    rec.onEnd(onEnd)
    await rec.start()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'test', confidence: 1.0 },
    ]))

    fakeRec.onend!(new Event('end'))

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(rec.getState()).toBe('idle')

    vi.useFakeTimers()
    vi.advanceTimersByTime(2000)
    expect(fakeRec.stop).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('removes one-shot start/error listeners after resolve so late errors do not leak', async () => {
    const rec = new WebSpeechRecognizer()
    const onError = vi.fn()
    rec.onError(onError)

    await rec.start()

    fakeRec.onerror!({ error: 'aborted' })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(rec.getState()).toBe('error')
  })

  it('onend after error resets state to idle', async () => {
    const rec = new WebSpeechRecognizer()
    const onEnd = vi.fn()
    rec.onEnd(onEnd)
    await rec.start()

    fakeRec.onerror!({ error: 'no-speech' })
    expect(rec.getState()).toBe('error')

    fakeRec.onend!(new Event('end'))

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(rec.getState()).toBe('idle')
    expect(rec.isCurrentlyListening()).toBe(false)
  })

  it('clearCallbacks clears pending inactivity timeout', async () => {
    const rec = new WebSpeechRecognizer()
    await rec.start()

    vi.useFakeTimers()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'test', confidence: 1.0 },
    ]))

    rec.clearCallbacks()

    vi.advanceTimersByTime(2000)
    expect(fakeRec.stop).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('uses the provided inactivity timeout instead of the default', async () => {
    const rec = new WebSpeechRecognizer()
    await rec.start({ inactivityTimeoutMs: 500 })

    vi.useFakeTimers()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'test', confidence: 1.0 },
    ]))

    vi.advanceTimersByTime(499)
    expect(fakeRec.stop).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fakeRec.stop).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('reports a pause endpoint with the final transcript after pauseMs', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onEnd = vi.fn()
    rec.onEnd(onEnd)
    await rec.start({ endpointing: { pauseMs: 800, noSpeechTimeoutMs: 5000 }, onEndOfSpeech })

    vi.useFakeTimers()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'hello', confidence: 1.0 },
    ]))

    vi.advanceTimersByTime(799)
    expect(fakeRec.stop).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fakeRec.stop).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).not.toHaveBeenCalled()

    fakeRec.onend!(new Event('end'))
    fakeRec.onend!(new Event('end'))

    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('pause', 'hello')
    expect(onEnd).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('reports a no-speech endpoint when no result arrives within noSpeechTimeoutMs', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onError = vi.fn()
    rec.onError(onError)

    vi.useFakeTimers()

    const startPromise = rec.start({ endpointing: { pauseMs: 800, noSpeechTimeoutMs: 1500 }, onEndOfSpeech })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    vi.advanceTimersByTime(1499)
    expect(onEndOfSpeech).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('no-speech', '')
    expect(fakeRec.stop).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('cancels the no-speech timeout once a result arrives', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()

    vi.useFakeTimers()

    const startPromise = rec.start({ endpointing: { pauseMs: 1000, noSpeechTimeoutMs: 1500 }, onEndOfSpeech })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'hi', confidence: 1.0 },
    ]))

    vi.advanceTimersByTime(1000)
    expect(onEndOfSpeech).not.toHaveBeenCalled()

    fakeRec.onend!(new Event('end'))
    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('pause', 'hi')
    vi.useRealTimers()
  })

  it('reports no-speech instead of an error when the browser raises no-speech during endpointing', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onError = vi.fn()
    rec.onError(onError)
    await rec.start({ endpointing: { pauseMs: 800, noSpeechTimeoutMs: 5000 }, onEndOfSpeech })

    fakeRec.onerror!({ error: 'no-speech' })

    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('no-speech', '')
    expect(onError).not.toHaveBeenCalled()
    expect(rec.getState()).toBe('error')

    fakeRec.onend!(new Event('end'))
    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(rec.getState()).toBe('idle')
  })

  it('does not report end of speech for a manual stop', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    await rec.start({ endpointing: { pauseMs: 800, noSpeechTimeoutMs: 5000 }, onEndOfSpeech })

    vi.useFakeTimers()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'hello', confidence: 1.0 },
    ]))

    rec.stop()
    fakeRec.onend!(new Event('end'))
    vi.advanceTimersByTime(5000)

    expect(onEndOfSpeech).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not report end of speech for an abort during endpointing', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    await rec.start({ endpointing: { pauseMs: 800, noSpeechTimeoutMs: 5000 }, onEndOfSpeech })

    vi.useFakeTimers()

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'hello', confidence: 1.0 },
    ]))

    rec.abort()
    fakeRec.onend!(new Event('end'))
    vi.advanceTimersByTime(5000)

    expect(onEndOfSpeech).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
