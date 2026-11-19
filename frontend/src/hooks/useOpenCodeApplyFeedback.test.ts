import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useOpenCodeApplyFeedback } from './useOpenCodeApplyFeedback'
import { renderHookWithProviders } from '@/test/render'

const hookProviders = {
  auth: false,
  theme: false,
  tts: false,
} as const

const configQueryKey = ['opencode', 'config', '/repo'] as const
const managedConfigQueryKey = ['opencode-config', 'managed'] as const
const healthQueryKey = ['health'] as const

describe('useOpenCodeApplyFeedback', () => {
  it('announces the applied message and refreshes server caches when no restart is needed', async () => {
    const { result, queryClient } = renderHookWithProviders(() => useOpenCodeApplyFeedback(), hookProviders)
    queryClient.setQueryData(configQueryKey, { data: {} })
    queryClient.setQueryData(managedConfigQueryKey, { config: {} })
    queryClient.setQueryData(healthQueryKey, {})

    act(() => {
      result.current({ appliedMessage: 'Configuration updated', restartRequired: false })
    })

    expect(await screen.findByText('Configuration updated')).toBeInTheDocument()
    expect(queryClient.getQueryState(configQueryKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(healthQueryKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(managedConfigQueryKey)?.isInvalidated).toBe(false)
  })

  it('points at the restart when the in-place reload failed', async () => {
    const { result } = renderHookWithProviders(() => useOpenCodeApplyFeedback(), hookProviders)

    act(() => {
      result.current({ appliedMessage: 'Configuration updated', restartRequired: true })
    })

    expect(
      await screen.findByText(
        'Configuration saved, but OpenCode could not reload it. Restart the server to apply changes.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Configuration updated')).toBeNull()
  })
})
