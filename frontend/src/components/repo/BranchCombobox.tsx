import { useMemo } from 'react'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import type { GitBranch } from '@/api/repos'
import { useRepoBranches } from '@/hooks/useRepoBranches'
import { getOriginOnlyBranchNames } from '@/lib/utils'

type RemoteBranchValue = 'none' | 'origin-prefixed' | 'bare'

interface BranchComboboxProps {
  repoId: number | undefined
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  enabled?: boolean
  include?: (branch: GitBranch) => boolean
  remotes?: RemoteBranchValue
  clearable?: boolean
  id?: string
  ariaLabel?: string
  listClassName?: string
}

/**
 * Searchable branch picker listing local branches plus origin-only remote branches,
 * which are the only refs the backend can resolve.
 */
export function BranchCombobox({
  repoId,
  value,
  onValueChange,
  placeholder,
  enabled = true,
  include,
  remotes = 'origin-prefixed',
  clearable = false,
  id,
  ariaLabel,
  listClassName,
}: BranchComboboxProps) {
  const { data: branchesData, isLoading } = useRepoBranches(repoId, enabled)

  const options = useMemo<ComboboxOption[]>(() => {
    const branches = branchesData?.branches ?? []
    const localOptions = branches
      .filter((branch) => branch.type === 'local' && (include?.(branch) ?? true))
      .map((branch) => ({
        value: branch.name,
        label: branch.name,
        description: branch.current ? 'current' : undefined,
        group: 'Local',
      }))
    if (remotes === 'none') return localOptions
    return [
      ...localOptions,
      ...getOriginOnlyBranchNames(branches).map((name) => ({
        value: remotes === 'origin-prefixed' ? `origin/${name}` : name,
        label: name,
        group: 'Remote',
      })),
    ]
  }, [branchesData, include, remotes])

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onValueChange}
      options={options}
      placeholder={isLoading ? 'Loading branches...' : placeholder}
      disabled={isLoading}
      allowCustomValue={false}
      showClear={clearable}
      ariaLabel={ariaLabel}
      listClassName={listClassName}
    />
  )
}
