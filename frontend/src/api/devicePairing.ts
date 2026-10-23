import type {
  CreateDevicePairingLinksRequest,
  DevicePairingLinksResponse,
  PairedDevice,
  PairedDevicesResponse,
  RedeemDevicePairingCodeRequest,
  RedeemDevicePairingCodeResponse,
  RemoteAccessHeadersResponse,
  ReplaceRemoteAccessHeadersRequest,
} from '@opencode-manager/shared/schemas'
import { API_BASE_URL } from '@/config'
import { getAuthBaseUrl } from '@/lib/auth-client'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

const REMOTE_ACCESS_HEADERS_URL = `${API_BASE_URL}/api/settings/remote-access-headers`

/** Redeems a browser pairing code and starts a session for the paired user. */
export async function redeemDevicePairingCode(
  body: RedeemDevicePairingCodeRequest,
): Promise<RedeemDevicePairingCodeResponse> {
  return fetchWrapper<RedeemDevicePairingCodeResponse>(
    `${getAuthBaseUrl()}/device-pairing/redeem`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

/** Reads the names of the stored remote-access headers without their values. */
export async function getRemoteAccessHeaders(): Promise<RemoteAccessHeadersResponse> {
  return fetchWrapper<RemoteAccessHeadersResponse>(REMOTE_ACCESS_HEADERS_URL)
}

/** Replaces the stored remote-access headers, keeping stored values for blank entries. */
export async function replaceRemoteAccessHeaders(
  body: ReplaceRemoteAccessHeadersRequest,
): Promise<RemoteAccessHeadersResponse> {
  return fetchWrapper<RemoteAccessHeadersResponse>(REMOTE_ACCESS_HEADERS_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Removes every stored remote-access header. */
export async function clearRemoteAccessHeaders(): Promise<RemoteAccessHeadersResponse> {
  return fetchWrapper<RemoteAccessHeadersResponse>(REMOTE_ACCESS_HEADERS_URL, {
    method: 'DELETE',
  })
}

/** Mints a pairing code and builds the app and browser links for this origin. */
export async function createDevicePairingLinks(
  body: CreateDevicePairingLinksRequest = {},
): Promise<DevicePairingLinksResponse> {
  return fetchWrapper<DevicePairingLinksResponse>(`${API_BASE_URL}/api/device-pairing/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Lists the devices signed in to this account. */
export async function listPairedDevices(): Promise<PairedDevice[]> {
  const response = await fetchWrapper<PairedDevicesResponse>(
    `${getAuthBaseUrl()}/device-pairing/devices`,
  )
  return response.devices
}

/** Signs one paired device out. */
export async function revokePairedDevice(id: string): Promise<void> {
  return fetchWrapperVoid(`${getAuthBaseUrl()}/device-pairing/devices/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}
