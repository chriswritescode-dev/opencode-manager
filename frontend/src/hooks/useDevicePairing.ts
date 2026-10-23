import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateDevicePairingLinksRequest,
  RemoteAccessHeadersResponse,
  ReplaceRemoteAccessHeadersRequest,
} from '@opencode-manager/shared/schemas'
import {
  clearRemoteAccessHeaders,
  createDevicePairingLinks,
  getDevicePairingAvailability,
  getRemoteAccessHeaders,
  listPairedDevices,
  replaceRemoteAccessHeaders,
  revokePairedDevice,
} from '@/api/devicePairing'

const REMOTE_ACCESS_HEADERS_QUERY_KEY = ['remote-access-headers']
const PAIRED_DEVICES_QUERY_KEY = ['paired-devices']
const DEVICE_PAIRING_AVAILABILITY_QUERY_KEY = ['device-pairing-availability']

export function useRemoteAccessHeaders() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: REMOTE_ACCESS_HEADERS_QUERY_KEY,
    queryFn: getRemoteAccessHeaders,
  })

  const setHeaders = (response: RemoteAccessHeadersResponse) => {
    queryClient.setQueryData(REMOTE_ACCESS_HEADERS_QUERY_KEY, response)
  }

  const replace = useMutation({
    mutationFn: (body: ReplaceRemoteAccessHeadersRequest) => replaceRemoteAccessHeaders(body),
    onSuccess: setHeaders,
  })

  const clear = useMutation({
    mutationFn: clearRemoteAccessHeaders,
    onSuccess: setHeaders,
  })

  return {
    headers: query.data?.headers ?? [],
    unreadable: query.data?.unreadable ?? false,
    isLoading: query.isLoading,
    replace,
    clear,
    isSaving: replace.isPending || clear.isPending,
  }
}

export function useCreateDevicePairingLinks() {
  return useMutation({
    mutationFn: (body: CreateDevicePairingLinksRequest = {}) => createDevicePairingLinks(body),
  })
}

export function useDevicePairingAvailability() {
  const origin = window.location.origin

  return useQuery({
    queryKey: [...DEVICE_PAIRING_AVAILABILITY_QUERY_KEY, origin],
    queryFn: () => getDevicePairingAvailability(origin),
  })
}

export function usePairedDevices() {
  return useQuery({
    queryKey: PAIRED_DEVICES_QUERY_KEY,
    queryFn: listPairedDevices,
  })
}

export function useInvalidatePairedDevices() {
  const queryClient = useQueryClient()

  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: PAIRED_DEVICES_QUERY_KEY }),
    [queryClient],
  )
}

export function useRevokePairedDevice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => revokePairedDevice(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PAIRED_DEVICES_QUERY_KEY }),
  })
}
