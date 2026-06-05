import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useScheduleTarget } from '../useScheduleTarget'
import type { AssistantModeStatus, Repo } from '@opencode-manager/shared/types'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  getAssistantModeStatus: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  getRepo: mocks.getRepo,
  getAssistantModeStatus: mocks.getAssistantModeStatus,
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useScheduleTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('repoId === 0 (assistant)', () => {
    it('returns assistant schedule target with correct properties', async () => {
      const mockStatus: AssistantModeStatus = {
        repoId: 0,
        directory: '/abs/assistant',
        relativePath: 'repos/assistant',
        files: {
          agentsMd: { path: '', exists: false, created: false },
          opencodeJson: { path: '', exists: false, created: false },
        },
        schedulesSkill: { path: '', exists: false, created: false },
      }

      mocks.getAssistantModeStatus.mockResolvedValue(mockStatus)

      const { result } = renderHook(() => useScheduleTarget(0), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.scheduleTarget).toBeDefined()
      })

      expect(result.current.scheduleTarget?.kind).toBe('assistant')
      expect(result.current.scheduleTarget?.fullPath).toBe('/abs/assistant')
      expect(result.current.scheduleTarget?.repoId).toBe(0)
      expect(result.current.scheduleTarget?.backHref).toBe('/assistant')
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isError).toBe(false)
    })

    it('does not call getRepo for assistant', async () => {
      mocks.getAssistantModeStatus.mockResolvedValue({
        directory: '/abs/assistant',
        relativePath: 'repos/assistant',
        files: { agentsMd: { path: '', exists: false, created: false }, opencodeJson: { path: '', exists: false, created: false } },
        schedulesSkill: { path: '', exists: false, created: false },
        repoId: 0,
      })

      renderHook(() => useScheduleTarget(0), { wrapper: createWrapper() })

      await vi.waitFor(() => {
        expect(mocks.getRepo).not.toHaveBeenCalled()
      })
    })
  })

  describe('repoId === 5 (real repo)', () => {
    it('returns repo schedule target with correct properties', async () => {
      const mockRepo: Repo = {
        id: 5,
        repoUrl: 'https://x/my-repo',
        localPath: 'repos/my-repo',
        fullPath: '/abs/repos/my-repo',
        sourcePath: undefined,
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: 0,
      }

      mocks.getRepo.mockResolvedValue(mockRepo)

      const { result } = renderHook(() => useScheduleTarget(5), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.scheduleTarget).toBeDefined()
      })

      expect(result.current.scheduleTarget?.kind).toBe('repo')
      expect(result.current.scheduleTarget?.repoId).toBe(5)
      expect(result.current.scheduleTarget?.fullPath).toBe('/abs/repos/my-repo')
      expect(result.current.scheduleTarget?.backHref).toBe('/repos/5')
    })

    it('does not call getAssistantModeStatus for repo', async () => {
      const mockRepo: Repo = {
        id: 5,
        repoUrl: 'https://x/my-repo',
        localPath: 'repos/my-repo',
        fullPath: '/abs/repos/my-repo',
        sourcePath: undefined,
        defaultBranch: 'main',
        cloneStatus: 'ready',
        clonedAt: 0,
      }

      mocks.getRepo.mockResolvedValue(mockRepo)

      renderHook(() => useScheduleTarget(5), { wrapper: createWrapper() })

      await vi.waitFor(() => {
        expect(mocks.getAssistantModeStatus).not.toHaveBeenCalled()
      })
    })
  })

  describe('repoId === undefined', () => {
    it('returns undefined schedule target', () => {
      const { result } = renderHook(() => useScheduleTarget(undefined), { wrapper: createWrapper() })

      expect(result.current.scheduleTarget).toBeUndefined()
      expect(result.current.isLoading).toBe(false)
    })
  })
})
