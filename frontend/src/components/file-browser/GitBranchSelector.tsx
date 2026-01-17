import { GitBranch, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface GitBranchSelectorProps {
  repoId: number | undefined
  branch: string | null
  branches: string[]
  onBranchChange: (branch: string) => void
  isLoading?: boolean
  error?: Error | null
  ahead?: number
  behind?: number
}

export function GitBranchSelector({ branch, branches, onBranchChange, isLoading, error, ahead, behind }: GitBranchSelectorProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading branches...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-red-500">Failed to load branches</span>
      </div>
    )
  }

  if (!branch || branches.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">No branches available</span>
      </div>
    )
  }

  const getBranchLabel = (branchName: string, isCurrent: boolean) => {
    if (!isCurrent) return branchName
    const parts = [branchName]
    if (ahead && ahead > 0) parts.push(`${ahead} ahead`)
    if (behind && behind > 0) parts.push(`${behind} behind`)
    return parts.join(' ')
  }

  return (
    <Select value={branch} onValueChange={onBranchChange}>
      <SelectTrigger className="w-full h-auto py-1.5">
        <div className="flex items-center gap-2 flex-1">
          <GitBranch className="w-4 h-4 text-muted-foreground" />
          <SelectValue placeholder="Select branch" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {branches.map((branchName) => (
          <SelectItem key={branchName} value={branchName}>
            <div className="flex items-center gap-2">
              <GitBranch className="w-3 h-3 text-muted-foreground" />
              <span className={cn(branchName === branch && 'font-medium')}>
                {getBranchLabel(branchName, branchName === branch)}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
