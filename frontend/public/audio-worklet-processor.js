class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this._targetSampleRate = options?.processorOptions?.targetSampleRate ?? 16000
    this._inputSampleRate = sampleRate
    this._ratio = this._inputSampleRate / this._targetSampleRate
    this._fraction = 0
    this._lastSample = 0
    this._active = true
    this._buffer = []
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this._active = false
      }
    }
  }

  process(inputs) {
    if (!this._active) {
      if (this._buffer.length > 0) {
        this._flushBuffer()
      }
      return false
    }

    const input = inputs[0]?.[0]
    if (!input || input.length === 0) {
      return true
    }

    const outputLength = Math.floor((input.length - this._fraction) / this._ratio)
    for (let i = 0; i < outputLength; i++) {
      const index = i * this._ratio + this._fraction
      const sample = this._interpolate(input, index)
      this._buffer.push(sample)
    }
    this._fraction = (outputLength * this._ratio) + this._fraction - input.length
    this._lastSample = input[input.length - 1]

    if (this._buffer.length >= 1024) {
      this._flushBuffer()
    }

    return true
  }

  _interpolate(input, index) {
    if (index < 0) {
      const t = (index % 1) + 1
      return this._lastSample * (1 - t) + input[0] * t
    }
    const prevIndex = Math.floor(index)
    const nextIndex = prevIndex + 1
    if (nextIndex >= input.length) {
      return input[prevIndex]
    }
    const t = index - prevIndex
    return input[prevIndex] * (1 - t) + input[nextIndex] * t
  }

  _flushBuffer() {
    const int16 = new Int16Array(this._buffer.length)
    for (let i = 0; i < this._buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, this._buffer[i]))
      int16[i] = sample < 0 ? sample * 32768 : sample * 32767
    }
    this.port.postMessage(int16, [int16.buffer])
    this._buffer = []
  }
}

registerProcessor('recorder-processor', RecorderProcessor)
