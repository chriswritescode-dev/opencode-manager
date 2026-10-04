import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserCog } from 'lucide-react'
import type { RepoGitIdentity } from '@opencode-manager/shared'
import { getRepoGitIdentity, updateRepoGitIdentity } from '@/api/repos'
import { getApiErrorMessage } from '@/api/git'
import { useSettings } from '@/hooks/useSettings'
import { showToast } from '@/lib/toast'
import { formatGitIdentity } from '@/lib/git-identity'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const DEFAULT_VALUE = 'default'
const CUSTOM_VALUE = 'custom'

interface RepoGitIdentitySelectProps {
  repoId: number
}

function defaultIdentityLabel(identity: RepoGitIdentity): string {
  if (identity.scope === 'none') return 'Default — not configured'
  if (identity.scope === 'default') return `Default — ${formatGitIdentity(identity)} (Manager default)`
  if (identity.scope === 'global') return `Default — ${formatGitIdentity(identity)} (git global config)`
  return 'Default'
}

export function RepoGitIdentitySelect({ repoId }: RepoGitIdentitySelectProps) {
  const queryClient = useQueryClient()
  const { data: identity } = useQuery({
    queryKey: ['repoGitIdentity', repoId],
    queryFn: () => getRepoGitIdentity(repoId),
  })
  const { preferences } = useSettings()

  const identities = preferences?.gitIdentities ?? []
  const repositoryPresetId = identity?.scope === 'repository' ? identity.presetId : null
  const matchingPresetId = repositoryPresetId && identities.some((preset) => preset.id === repositoryPresetId)
    ? repositoryPresetId
    : null
  const isCustom = identity?.scope === 'repository' && !matchingPresetId
  const selectedValue = matchingPresetId ?? (identity?.scope === 'repository' ? CUSTOM_VALUE : DEFAULT_VALUE)

  const mutation = useMutation({
    mutationFn: (identityId: string | null) => updateRepoGitIdentity(repoId, identityId),
    onSuccess: (data) => {
      queryClient.setQueryData(['repoGitIdentity', repoId], data)
    },
    onError: (error) => {
      showToast.error(getApiErrorMessage(error))
    },
  })

  const handleValueChange = (value: string) => {
    if (value === CUSTOM_VALUE) return
    if (isCustom && identity && !window.confirm(`Replace this repository's custom commit identity ${formatGitIdentity(identity)}?`)) {
      return
    }
    mutation.mutate(value === DEFAULT_VALUE ? null : value)
  }

  return (
    <div className="flex items-center gap-2">
      <UserCog className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="text-xs text-muted-foreground shrink-0">Commit as</span>
      <Select
        value={selectedValue}
        onValueChange={handleValueChange}
        disabled={mutation.isPending}
      >
        <SelectTrigger className="h-8 text-xs" aria-label="Commit identity">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>
            {identity ? defaultIdentityLabel(identity) : 'Default'}
          </SelectItem>
          {isCustom && identity && (
            <SelectItem value={CUSTOM_VALUE} disabled>
              Custom ({formatGitIdentity(identity)})
            </SelectItem>
          )}
          {identities.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {formatGitIdentity(preset)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
