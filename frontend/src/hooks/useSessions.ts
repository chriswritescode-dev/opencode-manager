import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionsApi } from '@/api/sessions'
import { showToast } from '@/lib/toast'
import type { CreateSessionInput } from '@opencode-manager/shared'

export function useSessionList(status?: string) {
  return useQuery({
    queryKey: ['sessions', status],
    queryFn: () => sessionsApi.listSessions(status),
  })
}

export function useSessionDetail(id: string) {
  return useQuery({
    queryKey: ['sessions', id],
    queryFn: () => sessionsApi.getSession(id),
    enabled: !!id,
  })
}

export function useCreateSession() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (data: CreateSessionInput) => sessionsApi.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      showToast.success('Workspace created successfully')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to create workspace: ${error.message}`)
    },
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ id, keepWorktrees }: { id: string; keepWorktrees?: boolean }) =>
      sessionsApi.deleteSession(id, keepWorktrees),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      showToast.success('Workspace deleted successfully')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to delete workspace: ${error.message}`)
    },
  })
}

export function useStartSession() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (id: string) => sessionsApi.startSession(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      showToast.success('Workspace starting...')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to start workspace: ${error.message}`)
    },
  })
}

export function useStopSession() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (id: string) => sessionsApi.stopSession(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      showToast.success('Workspace stopping...')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to stop workspace: ${error.message}`)
    },
  })
}

export function useRestartSession() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (id: string) => sessionsApi.restartSession(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      showToast.success('Workspace restarting...')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to restart workspace: ${error.message}`)
    },
  })
}

export function useSetPublicAccess() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      sessionsApi.setPublicAccess(id, enabled),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      showToast.success('Public access updated')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to update public access: ${error.message}`)
    },
  })
}

export function useDevcontainerRequests(sessionId: string) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'devcontainer-requests'],
    queryFn: () => sessionsApi.listDevcontainerRequests(sessionId),
    enabled: !!sessionId,
  })
}

export function useApproveDevcontainerRequest() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ sessionId, requestId }: { sessionId: string; requestId: number }) =>
      sessionsApi.approveDevcontainerRequest(sessionId, requestId),
    onSuccess: (_, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'devcontainer-requests'] })
      showToast.success('Request approved')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to approve request: ${error.message}`)
    },
  })
}

export function useRejectDevcontainerRequest() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ sessionId, requestId }: { sessionId: string; requestId: number }) =>
      sessionsApi.rejectDevcontainerRequest(sessionId, requestId),
    onSuccess: (_, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'devcontainer-requests'] })
      showToast.success('Request rejected')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to reject request: ${error.message}`)
    },
  })
}

export function useApplyDevcontainerRequest() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ sessionId, requestId }: { sessionId: string; requestId: number }) =>
      sessionsApi.applyDevcontainerRequest(sessionId, requestId),
    onSuccess: (_, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'devcontainer-requests'] })
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      showToast.success('Request applied successfully')
    },
    onError: (error: Error) => {
      showToast.error(`Failed to apply request: ${error.message}`)
    },
  })
}
