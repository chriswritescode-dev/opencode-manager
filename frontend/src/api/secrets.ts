import { API_BASE_URL } from '@/config'
import {
  SecretListResponseSchema,
  type SecretKind,
  type SecretListResponse,
  type SetSecretRequest,
} from '@opencode-manager/shared/schemas'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

export type SecretScope = { scope: 'global' } | { scope: 'repo'; repoId: number }

const KIND_SEGMENT = {
  secret: 'secrets',
  variable: 'variables',
} satisfies Record<SecretKind, string>

function secretsPath(scope: SecretScope, kind: SecretKind): string {
  const segment = KIND_SEGMENT[kind]
  return scope.scope === 'global'
    ? `${API_BASE_URL}/api/${segment}`
    : `${API_BASE_URL}/api/repos/${scope.repoId}/${segment}`
}

export async function listSecrets(scope: SecretScope, kind: SecretKind): Promise<SecretListResponse> {
  return fetchWrapper(secretsPath(scope, kind), SecretListResponseSchema)
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
    params: environment ? { environment } : undefined,
  })
}
