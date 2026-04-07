class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._active = true
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this._active = false
      }
    }
  }

  process(inputs) {
    if (!this._active) return false
    const input = inputs[0]
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(new Float32Array(input[0]))
    }
    return true
  }
}

registerProcessor('recorder-processor', RecorderProcessor)
