import { API_BASE_URL } from '@/config'
import type { SecretKind, SecretListResponse, SetSecretRequest } from '@opencode-manager/shared/schemas'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

export type SecretScope = { scope: 'global' } | { scope: 'repo'; repoId: number }

const KIND_SEGMENT: Record<SecretKind, string> = {
  secret: 'secrets',
  variable: 'variables',
}

function secretsPath(scope: SecretScope, kind: SecretKind): string {
  const segment = KIND_SEGMENT[kind]
  return scope.scope === 'global'
    ? `${API_BASE_URL}/api/${segment}`
    : `${API_BASE_URL}/api/repos/${scope.repoId}/${segment}`
}

export async function listSecrets(scope: SecretScope, kind: SecretKind): Promise<SecretListResponse> {
  return fetchWrapper(secretsPath(scope, kind))
}

export async function setSecret(
  scope: SecretScope,
  kind: SecretKind,
  name: string,
  request: SetSecretRequest,
): Promise<void> {
  return fetchWrapperVoid(`${secretsPath(scope, kind)}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function deleteSecret(
  scope: SecretScope,
  kind: SecretKind,
  name: string,
  environment?: string,
): Promise<void> {
  return fetchWrapperVoid(`${secretsPath(scope, kind)}/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    ...(environment ? { params: { environment } } : {}),
  })
}
