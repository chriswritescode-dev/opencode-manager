import { describe, it, expect } from 'vitest'
import { VoiceActivityDetector } from './voiceActivityDetector'

const SAMPLE_RATE = 16000
const msToSamples = (ms: number): number => Math.round((ms / 1000) * SAMPLE_RATE)

describe('VoiceActivityDetector', () => {
  it('classifies loud frames as speech and quiet frames as silence', () => {
    const vad = new VoiceActivityDetector({ sampleRate: SAMPLE_RATE })

    expect(vad.process(0.2, msToSamples(100)).isSpeech).toBe(true)
    expect(vad.process(0.0005, msToSamples(100)).isSpeech).toBe(false)
  })

  it('reports hasSpeech only after cumulative speech exceeds minSpeechMs', () => {
    const vad = new VoiceActivityDetector({ sampleRate: SAMPLE_RATE, minSpeechMs: 150 })

    vad.process(0.2, msToSamples(100))
    expect(vad.hasSpeech).toBe(false)

    vad.process(0.2, msToSamples(100))
    expect(vad.hasSpeech).toBe(true)
  })

  it('does not flag pure silence as speech', () => {
    const vad = new VoiceActivityDetector({ sampleRate: SAMPLE_RATE })

    for (let i = 0; i < 10; i++) {
      vad.process(0.0008, msToSamples(100))
    }

    expect(vad.hasSpeech).toBe(false)
  })

  it('auto-stops after trailing silence once speech has started', () => {
    const vad = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      minSpeechMs: 50,
      silenceTimeoutMs: 200,
    })

    expect(vad.process(0.2, msToSamples(100)).shouldAutoStop).toBe(false)
    expect(vad.process(0.0005, msToSamples(100)).shouldAutoStop).toBe(false)
    expect(vad.process(0.0005, msToSamples(100)).shouldAutoStop).toBe(true)
  })

  it('does not auto-stop during leading silence before any speech', () => {
    const vad = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      silenceTimeoutMs: 200,
    })

    for (let i = 0; i < 10; i++) {
      expect(vad.process(0.0005, msToSamples(100)).shouldAutoStop).toBe(false)
    }
  })

  it('never auto-stops when silenceTimeoutMs is 0', () => {
    const vad = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      minSpeechMs: 50,
      silenceTimeoutMs: 0,
    })

    vad.process(0.2, msToSamples(100))
    for (let i = 0; i < 20; i++) {
      expect(vad.process(0.0005, msToSamples(100)).shouldAutoStop).toBe(false)
    }
  })

  it('resets accumulated speech and silence state', () => {
    const vad = new VoiceActivityDetector({ sampleRate: SAMPLE_RATE, minSpeechMs: 50 })

    vad.process(0.2, msToSamples(100))
    expect(vad.hasSpeech).toBe(true)

    vad.reset()
    expect(vad.hasSpeech).toBe(false)
    expect(vad.process(0.0005, msToSamples(100)).shouldAutoStop).toBe(false)
  })

  it('resets trailing silence when speech resumes', () => {
    const vad = new VoiceActivityDetector({
      sampleRate: SAMPLE_RATE,
      minSpeechMs: 50,
      silenceTimeoutMs: 200,
    })

    vad.process(0.2, msToSamples(100))
    vad.process(0.0005, msToSamples(100))
    vad.process(0.2, msToSamples(100))
    expect(vad.process(0.0005, msToSamples(100)).shouldAutoStop).toBe(false)
  })
})
