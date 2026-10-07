import { describe, it, expect, beforeEach } from 'vitest'
import { locationAgentKey, useModelStore } from '@/stores/modelStore'

const resetStore = () => {
  useModelStore.setState({ newSessionPicks: {}, sessionPicks: {}, activeAgent: null })
}

describe('locationAgentKey', () => {
  it('combines the directory and agent id', () => {
    expect(locationAgentKey('/repo', 'build')).toBe(JSON.stringify(['/repo', 'build']))
  })

  it('normalizes missing values', () => {
    expect(locationAgentKey(undefined, undefined)).toBe(JSON.stringify(['', '']))
    expect(locationAgentKey(undefined, 'build')).toBe(JSON.stringify(['', 'build']))
  })
})

describe('setNewSessionPick', () => {
  beforeEach(resetStore)

  it('stores a selection under its key', () => {
    useModelStore.getState().setNewSessionPick('key', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    expect(useModelStore.getState().newSessionPicks.key).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' })
  })

  it('stores the variant with the selection', () => {
    useModelStore.getState().setNewSessionPick('key', { providerID: 'anthropic', modelID: 'claude-sonnet-4', variant: 'high' })
    expect(useModelStore.getState().newSessionPicks.key.variant).toBe('high')
  })

  it('does not notify subscribers when the selection is unchanged', () => {
    useModelStore.getState().setNewSessionPick('key', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })

    let updateCount = 0
    const unsubscribe = useModelStore.subscribe(() => {
      updateCount++
    })

    useModelStore.getState().setNewSessionPick('key', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    unsubscribe()

    expect(updateCount).toBe(0)
  })

  it('treats a default variant as no variant for equality', () => {
    useModelStore.getState().setNewSessionPick('key', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })

    let updateCount = 0
    const unsubscribe = useModelStore.subscribe(() => {
      updateCount++
    })

    useModelStore.getState().setNewSessionPick('key', { providerID: 'anthropic', modelID: 'claude-sonnet-4', variant: 'default' })
    unsubscribe()

    expect(updateCount).toBe(0)
  })

  it('updates when only the variant changes', () => {
    useModelStore.getState().setNewSessionPick('key', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    useModelStore.getState().setNewSessionPick('key', { providerID: 'anthropic', modelID: 'claude-sonnet-4', variant: 'high' })
    expect(useModelStore.getState().newSessionPicks.key.variant).toBe('high')
  })
})

describe('setSessionPick', () => {
  beforeEach(resetStore)

  it('stores a per-session agent selection', () => {
    useModelStore.getState().setSessionPick('session-1', 'build', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    expect(useModelStore.getState().sessionPicks['session-1'].build).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
    })
  })

  it('keeps selections for different agents independent', () => {
    useModelStore.getState().setSessionPick('session-1', 'build', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    useModelStore.getState().setSessionPick('session-1', 'plan', { providerID: 'openai', modelID: 'gpt-4o' })
    expect(useModelStore.getState().sessionPicks['session-1'].build.modelID).toBe('claude-sonnet-4')
    expect(useModelStore.getState().sessionPicks['session-1'].plan.modelID).toBe('gpt-4o')
  })

  it('removes the selection when set to undefined', () => {
    useModelStore.getState().setSessionPick('session-1', 'build', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    useModelStore.getState().setSessionPick('session-1', 'build', undefined)
    expect(useModelStore.getState().sessionPicks['session-1'].build).toBeUndefined()
  })

  it('does not notify subscribers when the selection is unchanged', () => {
    useModelStore.getState().setSessionPick('session-1', 'build', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })

    let updateCount = 0
    const unsubscribe = useModelStore.subscribe(() => {
      updateCount++
    })

    useModelStore.getState().setSessionPick('session-1', 'build', { providerID: 'anthropic', modelID: 'claude-sonnet-4' })
    unsubscribe()

    expect(updateCount).toBe(0)
  })
})

describe('setActiveAgent', () => {
  beforeEach(resetStore)

  it('stores the active agent', () => {
    useModelStore.getState().setActiveAgent({ id: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } })
    expect(useModelStore.getState().activeAgent).toEqual({
      id: 'build',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    })
  })

  it('does not notify subscribers when the id and model ref are unchanged', () => {
    useModelStore.getState().setActiveAgent({ id: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } })

    let updateCount = 0
    const unsubscribe = useModelStore.subscribe(() => {
      updateCount++
    })

    useModelStore.getState().setActiveAgent({ id: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } })
    unsubscribe()

    expect(updateCount).toBe(0)
  })

  it('updates when the agent model ref changes', () => {
    useModelStore.getState().setActiveAgent({ id: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } })
    useModelStore.getState().setActiveAgent({ id: 'build', model: { providerID: 'openai', id: 'gpt-4o' } })
    expect(useModelStore.getState().activeAgent?.model).toEqual({ providerID: 'openai', id: 'gpt-4o' })
  })

  it('updates when the agent id changes', () => {
    useModelStore.getState().setActiveAgent({ id: 'build', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } })
    useModelStore.getState().setActiveAgent({ id: 'plan', model: { providerID: 'anthropic', id: 'claude-sonnet-4' } })
    expect(useModelStore.getState().activeAgent?.id).toBe('plan')
  })
})
