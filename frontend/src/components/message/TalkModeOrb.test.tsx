import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TalkModeOrb } from './TalkModeOrb'

describe('TalkModeOrb', () => {
  it('should render without crashing', () => {
    render(<TalkModeOrb state="off" userSpeaking={false} />)
    
    const orb = document.querySelector('.rounded-full')
    expect(orb).toBeInTheDocument()
  })

  it('should apply initializing state colors', () => {
    render(<TalkModeOrb state="initializing" userSpeaking={false} />)
    
    const orb = document.querySelector('.from-gray-400')
    expect(orb).toBeInTheDocument()
  })

  it('should apply listening state colors when not speaking', () => {
    render(<TalkModeOrb state="listening" userSpeaking={false} />)
    
    const orb = document.querySelector('.from-cyan-400')
    expect(orb).toBeInTheDocument()
  })

  it('should apply active colors when user is speaking', () => {
    render(<TalkModeOrb state="listening" userSpeaking={true} />)
    
    const orb = document.querySelector('.from-green-400')
    expect(orb).toBeInTheDocument()
  })

  it('should apply thinking state colors', () => {
    render(<TalkModeOrb state="thinking" userSpeaking={false} />)
    
    const orb = document.querySelector('.from-yellow-400')
    expect(orb).toBeInTheDocument()
  })

  it('should apply speaking state colors', () => {
    render(<TalkModeOrb state="speaking" userSpeaking={false} />)
    
    const orb = document.querySelector('.from-purple-400')
    expect(orb).toBeInTheDocument()
  })

  it('should apply error state colors', () => {
    render(<TalkModeOrb state="error" userSpeaking={false} />)
    
    const orb = document.querySelector('.from-red-400')
    expect(orb).toBeInTheDocument()
  })

  it('should apply pulse animation during initializing', () => {
    render(<TalkModeOrb state="initializing" userSpeaking={false} />)
    
    const orb = document.querySelector('.animate-pulse')
    expect(orb).toBeInTheDocument()
  })

  it('should apply idle animation when listening but not speaking', () => {
    render(<TalkModeOrb state="listening" userSpeaking={false} />)
    
    const orb = document.querySelector('.animate-talk-mode-idle')
    expect(orb).toBeInTheDocument()
  })

  it('should apply active animation when user is speaking', () => {
    render(<TalkModeOrb state="listening" userSpeaking={true} />)
    
    const orb = document.querySelector('.animate-talk-mode-active')
    expect(orb).toBeInTheDocument()
  })

  it('should apply spin animation during thinking', () => {
    render(<TalkModeOrb state="thinking" userSpeaking={false} />)
    
    const orb = document.querySelector('.animate-spin-slow')
    expect(orb).toBeInTheDocument()
  })

  it('should apply speaking animation when speaking', () => {
    render(<TalkModeOrb state="speaking" userSpeaking={false} />)
    
    const orb = document.querySelector('.animate-talk-mode-speaking')
    expect(orb).toBeInTheDocument()
  })

  it('should show ping effects when listening', () => {
    render(<TalkModeOrb state="listening" userSpeaking={false} />)
    
    const pingElements = document.querySelectorAll('.animate-ping-slow, .animate-ping-slower')
    expect(pingElements.length).toBe(2)
  })

  it('should show ping effects when speaking', () => {
    render(<TalkModeOrb state="speaking" userSpeaking={false} />)
    
    const pingElements = document.querySelectorAll('.animate-ping-slow, .animate-ping-slower')
    expect(pingElements.length).toBe(2)
  })

  it('should not show ping effects when off', () => {
    render(<TalkModeOrb state="off" userSpeaking={false} />)
    
    const pingElements = document.querySelectorAll('.animate-ping-slow, .animate-ping-slower')
    expect(pingElements.length).toBe(0)
  })

  it('should accept custom className', () => {
    render(<TalkModeOrb state="off" userSpeaking={false} className="custom-class" />)
    
    const container = document.querySelector('.custom-class')
    expect(container).toBeInTheDocument()
  })

  it('should apply glow shadow based on state', () => {
    render(<TalkModeOrb state="listening" userSpeaking={false} />)
    
    const orb = document.querySelector('.shadow-cyan-500\\/50')
    expect(orb).toBeInTheDocument()
  })

  it('should apply green glow when user is speaking', () => {
    render(<TalkModeOrb state="listening" userSpeaking={true} />)
    
    const orb = document.querySelector('.shadow-green-500\\/50')
    expect(orb).toBeInTheDocument()
  })
})
