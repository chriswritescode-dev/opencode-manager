import {
  DevicePairingAvailabilitySchema,
  DevicePairingLinksResponseSchema,
  PairedDevicesResponseSchema,
  RedeemDevicePairingCodeResponseSchema,
  RemoteAccessHeadersResponseSchema,
} from '@opencode-manager/shared/schemas'
import type {
  CreateDevicePairingLinksRequest,
  DevicePairingAvailability,
  DevicePairingLinksResponse,
  PairedDevice,
  RedeemDevicePairingCodeRequest,
  RedeemDevicePairingCodeResponse,
  RemoteAccessHeadersResponse,
  ReplaceRemoteAccessHeadersRequest,
} from '@opencode-manager/shared/schemas'
import { API_BASE_URL } from '@/config'
import { getAuthBaseUrl } from '@/lib/auth-client'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

const REMOTE_ACCESS_HEADERS_URL = `${API_BASE_URL}/api/settings/remote-access-headers`

export async function redeemDevicePairingCode(
  body: RedeemDevicePairingCodeRequest,
): Promise<RedeemDevicePairingCodeResponse> {
  return fetchWrapper(
    `${getAuthBaseUrl()}/device-pairing/redeem`,
    RedeemDevicePairingCodeResponseSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

export async function getRemoteAccessHeaders(): Promise<RemoteAccessHeadersResponse> {
  return fetchWrapper(REMOTE_ACCESS_HEADERS_URL, RemoteAccessHeadersResponseSchema)
}

export async function replaceRemoteAccessHeaders(
  body: ReplaceRemoteAccessHeadersRequest,
): Promise<RemoteAccessHeadersResponse> {
  return fetchWrapper(REMOTE_ACCESS_HEADERS_URL, RemoteAccessHeadersResponseSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function clearRemoteAccessHeaders(): Promise<RemoteAccessHeadersResponse> {
  return fetchWrapper(REMOTE_ACCESS_HEADERS_URL, RemoteAccessHeadersResponseSchema, {
    method: 'DELETE',
  })
}

export async function createDevicePairingLinks(
  body: CreateDevicePairingLinksRequest = {},
): Promise<DevicePairingLinksResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/device-pairing/links`, DevicePairingLinksResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function getDevicePairingAvailability(
  origin: string,
): Promise<DevicePairingAvailability> {
  return fetchWrapper(
    `${API_BASE_URL}/api/device-pairing/availability`,
    DevicePairingAvailabilitySchema,
    { params: { origin } },
  )
}

export async function listPairedDevices(): Promise<PairedDevice[]> {
  const response = await fetchWrapper(
    `${getAuthBaseUrl()}/device-pairing/devices`,
    PairedDevicesResponseSchema,
  )
  return response.devices
}

export async function revokePairedDevice(id: string): Promise<void> {
  return fetchWrapperVoid(`${getAuthBaseUrl()}/device-pairing/devices/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}
