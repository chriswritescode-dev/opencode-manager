import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SecretEntry, SecretKind } from '@opencode-manager/shared/schemas'
import { deleteSecret, listSecrets, setSecret, type SecretScope } from '@/api/secrets'

export interface SetSecretVariables {
  kind: SecretKind
  name: string
  value: string
  environment?: string
}

export interface DeleteSecretVariables {
  kind: SecretKind
  name: string
  environment?: string
}

function scopeKey(scope: SecretScope): string {
  return scope.scope === 'global' ? 'global' : `repo:${scope.repoId}`
}

export function secretsQueryKey(scope: SecretScope, kind: SecretKind) {
  return ['secrets', scopeKey(scope), kind] as const
}

export function useSecretEntries(scope: SecretScope, kind: SecretKind) {
  return useQuery({
    queryKey: secretsQueryKey(scope, kind),
    queryFn: async (): Promise<SecretEntry[]> => (await listSecrets(scope, kind)).items,
  })
}

export function useSetSecret(scope: SecretScope) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ kind, name, value, environment }: SetSecretVariables) =>
      setSecret(scope, kind, name, environment ? { value, environment } : { value }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: secretsQueryKey(scope, variables.kind) })
    },
  })
}

export function useDeleteSecret(scope: SecretScope) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ kind, name, environment }: DeleteSecretVariables) =>
      deleteSecret(scope, kind, name, environment),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: secretsQueryKey(scope, variables.kind) })
    },
  })
}
