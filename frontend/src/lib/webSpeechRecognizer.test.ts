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

  it('reports no-speech instead of an error when Chrome raises no-speech after the deadline', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onError = vi.fn()
    const onEnd = vi.fn()
    rec.onError(onError)
    rec.onEnd(onEnd)

    vi.useFakeTimers()

    const startPromise = rec.start({ endpointing: { pauseMs: 800, noSpeechTimeoutMs: 5000 }, onEndOfSpeech })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    vi.setSystemTime(Date.now() + 5000)
    fakeRec.onerror!({ error: 'no-speech' })

    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('no-speech', '')
    expect(onError).not.toHaveBeenCalled()
    expect(fakeRec.start).toHaveBeenCalledTimes(1)

    fakeRec.onend!(new Event('end'))
    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(rec.getState()).toBe('idle')
    vi.useRealTimers()
  })

  it('restarts transparently when Chrome raises no-speech before the deadline', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onError = vi.fn()
    const onEnd = vi.fn()
    const onStart = vi.fn()
    rec.onError(onError)
    rec.onEnd(onEnd)
    rec.onStart(onStart)

    vi.useFakeTimers()

    const startPromise = rec.start({
      endpointing: { pauseMs: 2000, noSpeechTimeoutMs: 10000 },
      onEndOfSpeech,
    })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    expect(onStart).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(6000)
    fakeRec.onerror!({ error: 'no-speech' })

    expect(onEndOfSpeech).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    fakeRec.onend!(new Event('end'))
    await vi.advanceTimersByTimeAsync(0)

    expect(fakeRec.start).toHaveBeenCalledTimes(2)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    expect(rec.isCurrentlyListening()).toBe(true)

    vi.advanceTimersByTime(3999)
    expect(onEndOfSpeech).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('no-speech', '')

    fakeRec.onend!(new Event('end'))
    expect(onEnd).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('restarts when recognition ends unexpectedly before the deadline without speech', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onError = vi.fn()
    const onEnd = vi.fn()
    const onStart = vi.fn()
    rec.onError(onError)
    rec.onEnd(onEnd)
    rec.onStart(onStart)

    vi.useFakeTimers()

    const startPromise = rec.start({
      endpointing: { pauseMs: 2000, noSpeechTimeoutMs: 10000 },
      onEndOfSpeech,
    })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    vi.advanceTimersByTime(3000)
    fakeRec.onend!(new Event('end'))
    await vi.advanceTimersByTimeAsync(0)

    expect(fakeRec.start).toHaveBeenCalledTimes(2)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(onEndOfSpeech).not.toHaveBeenCalled()
    expect(rec.isCurrentlyListening()).toBe(true)
    vi.useRealTimers()
  })

  it('reports a pause with the final transcript when recognition ends unexpectedly', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onEnd = vi.fn()
    rec.onEnd(onEnd)

    vi.useFakeTimers()

    const startPromise = rec.start({
      endpointing: { pauseMs: 2000, noSpeechTimeoutMs: 10000 },
      onEndOfSpeech,
    })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'hello world', confidence: 1.0 },
    ]))

    fakeRec.onend!(new Event('end'))

    expect(fakeRec.start).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('pause', 'hello world')
    expect(onEnd).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('keeps the accumulated transcript across transparent restarts', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()

    vi.useFakeTimers()

    const startPromise = rec.start({
      endpointing: { pauseMs: 5000, noSpeechTimeoutMs: 10000 },
      onEndOfSpeech,
    })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'hello', confidence: 1.0 },
    ]))

    vi.advanceTimersByTime(1000)
    fakeRec.onerror!({ error: 'no-speech' })
    fakeRec.onend!(new Event('end'))
    await vi.advanceTimersByTimeAsync(0)

    expect(rec.getFinalTranscript()).toBe('hello')

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: true, transcript: 'world', confidence: 1.0 },
    ]))
    fakeRec.onend!(new Event('end'))

    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('pause', 'hello world')
    vi.useRealTimers()
  })

  it('reports a pause with the interim transcript when recognition ends unexpectedly before a final result', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()

    vi.useFakeTimers()

    const startPromise = rec.start({
      endpointing: { pauseMs: 2000, noSpeechTimeoutMs: 10000 },
      onEndOfSpeech,
    })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    fakeRec.onresult!(makeResultEvent(0, 1, [
      { isFinal: false, transcript: 'hello there', confidence: 0.0 },
    ]))

    fakeRec.onend!(new Event('end'))

    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('pause', 'hello there')
    vi.useRealTimers()
  })

  it('cancels a pending restart when stop() is called', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onEnd = vi.fn()
    rec.onEnd(onEnd)

    vi.useFakeTimers()

    const startPromise = rec.start({
      endpointing: { pauseMs: 2000, noSpeechTimeoutMs: 10000 },
      onEndOfSpeech,
    })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    vi.advanceTimersByTime(3000)
    fakeRec.onerror!({ error: 'no-speech' })
    rec.stop()
    fakeRec.onend!(new Event('end'))
    await vi.advanceTimersByTimeAsync(0)

    expect(fakeRec.start).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('surfaces an error when a transparent restart throws', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onError = vi.fn()
    const onEnd = vi.fn()
    rec.onError(onError)
    rec.onEnd(onEnd)

    vi.useFakeTimers()

    const startPromise = rec.start({
      endpointing: { pauseMs: 2000, noSpeechTimeoutMs: 10000 },
      onEndOfSpeech,
    })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    fakeRec.start.mockImplementationOnce(() => {
      throw new Error('InvalidStateError')
    })

    vi.advanceTimersByTime(3000)
    fakeRec.onend!(new Event('end'))

    expect(fakeRec.start).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('Speech recognition stopped unexpectedly. Please try again.')
    expect(onEndOfSpeech).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(rec.getState()).toBe('idle')
    vi.useRealTimers()
  })

  it('stops restarting after the transparent restart cap', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()
    const onEnd = vi.fn()
    rec.onEnd(onEnd)

    vi.useFakeTimers()

    const startPromise = rec.start({
      endpointing: { pauseMs: 2000, noSpeechTimeoutMs: 20000 },
      onEndOfSpeech,
    })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(500)
      fakeRec.onerror!({ error: 'no-speech' })
      fakeRec.onend!(new Event('end'))
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(fakeRec.start).toHaveBeenCalledTimes(6)
    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('no-speech', '')
    expect(onEnd).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('stops restarting when a restarted session ends immediately without audio', async () => {
    const rec = new WebSpeechRecognizer()
    const onEndOfSpeech = vi.fn()

    vi.useFakeTimers()

    const startPromise = rec.start({
      endpointing: { pauseMs: 2000, noSpeechTimeoutMs: 10000 },
      onEndOfSpeech,
    })
    await vi.advanceTimersByTimeAsync(0)
    await startPromise

    vi.advanceTimersByTime(3000)
    fakeRec.onend!(new Event('end'))
    await vi.advanceTimersByTimeAsync(0)

    vi.advanceTimersByTime(100)
    fakeRec.onend!(new Event('end'))

    expect(fakeRec.start).toHaveBeenCalledTimes(2)
    expect(onEndOfSpeech).toHaveBeenCalledTimes(1)
    expect(onEndOfSpeech).toHaveBeenCalledWith('no-speech', '')
    vi.useRealTimers()
  })

  it('surfaces Chrome no-speech as an error when endpointing is off', async () => {
    const rec = new WebSpeechRecognizer()
    const onError = vi.fn()
    const onEnd = vi.fn()
    rec.onError(onError)
    rec.onEnd(onEnd)

    await rec.start()

    fakeRec.onerror!({ error: 'no-speech' })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('No speech detected. Please try again.')
    expect(fakeRec.start).toHaveBeenCalledTimes(1)

    fakeRec.onend!(new Event('end'))
    expect(onEnd).toHaveBeenCalledTimes(1)
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
