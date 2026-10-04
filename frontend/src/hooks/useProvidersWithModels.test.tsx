import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useProvidersWithModels } from './useProvidersWithModels'
import type { ProviderWithModels } from '@/api/providers'

const mocks = vi.hoisted(() => ({
  getProvidersWithModels: vi.fn(),
}))

vi.mock('@/api/providers', () => ({
  getProvidersWithModels: mocks.getProvidersWithModels,
}))

vi.mock('@/hooks/useOpenCodeConfigFile', () => ({
  useOpenCodeConfigFile: () => ({ data: undefined, isLoading: false }),
}))

function provider(id: string, modelIds: string[]): ProviderWithModels {
  return {
    id,
    name: id,
    models: modelIds.map((modelId) => ({ id: modelId, name: modelId })),
    source: 'builtin',
    isConnected: true,
  }
}

const CATALOGS: Record<string, ProviderWithModels[]> = {
  '/repo-a': [provider('a-provider', ['a-model'])],
  '/repo-b': [provider('b-provider', ['b-model'])],
  default: [provider('default-provider', ['default-model'])],
}

function Consumer({ testId, directory, keyParts }: { testId: string; directory?: string; keyParts?: readonly unknown[] }) {
  const { data } = useProvidersWithModels({ enabled: true, directory, keyParts })
  return (
    <div data-testid={testId}>
      {data.map((entry) => `${entry.id}:${entry.models.map((model) => model.id).join('+')}`).join(',')}
    </div>
  )
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useProvidersWithModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getProvidersWithModels.mockImplementation(async (directory?: string) => CATALOGS[directory ?? 'default'] ?? [])
  })

  it('scopes the cache by directory so a new directory is fetched even while the previous location is fresh', async () => {
    const wrapper = createWrapper()
    const { rerender } = render(
      <>
        <Consumer testId="scoped" directory="/repo-a" />
        <Consumer testId="default" />
      </>,
      { wrapper },
    )

    await waitFor(() => {
      expect(screen.getByTestId('scoped')).toHaveTextContent('a-provider:a-model')
    })
    expect(screen.getByTestId('default')).toHaveTextContent('default-provider:default-model')
    expect(mocks.getProvidersWithModels).toHaveBeenCalledWith('/repo-a', undefined)
    expect(mocks.getProvidersWithModels).toHaveBeenCalledWith(undefined, undefined)

    mocks.getProvidersWithModels.mockClear()

    rerender(
      <>
        <Consumer testId="scoped" directory="/repo-b" />
        <Consumer testId="default" />
      </>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('scoped')).toHaveTextContent('b-provider:b-model')
    })
    expect(screen.getByTestId('default')).toHaveTextContent('default-provider:default-model')
    expect(mocks.getProvidersWithModels).toHaveBeenCalledWith('/repo-b', undefined)
    expect(mocks.getProvidersWithModels).toHaveBeenCalledTimes(1)
  })

  it('shares one fetch per directory and keeps the default location and keyParts callers distinct', async () => {
    const wrapper = createWrapper()
    render(
      <>
        <Consumer testId="scoped-one" directory="/repo-a" />
        <Consumer testId="scoped-two" directory="/repo-a" />
        <Consumer testId="keyed" directory="/repo-a" keyParts={['schedule-models']} />
        <Consumer testId="default" />
      </>,
      { wrapper },
    )

    await waitFor(() => {
      expect(screen.getByTestId('scoped-one')).toHaveTextContent('a-provider:a-model')
    })
    expect(screen.getByTestId('scoped-two')).toHaveTextContent('a-provider:a-model')
    expect(screen.getByTestId('keyed')).toHaveTextContent('a-provider:a-model')
    expect(screen.getByTestId('default')).toHaveTextContent('default-provider:default-model')

    expect(mocks.getProvidersWithModels).toHaveBeenCalledTimes(3)
  })
})
