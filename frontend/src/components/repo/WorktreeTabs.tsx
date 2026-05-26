import { useNavigate } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { GitBranch, X } from 'lucide-react'
import type { RepoSibling } from '@/api/repos'

interface WorktreeTabsProps {
  siblings: RepoSibling[]
  activeRepoId: number
  activeValue?: string
  onSelectWorkspace?: (workspaceId: string) => void
  onDeleteWorkspace?: (workspaceId: string) => void
  deletingWorkspaceId?: string
}

export function WorktreeTabs({
  siblings,
  activeRepoId,
  activeValue = String(activeRepoId),
  onSelectWorkspace,
  onDeleteWorkspace,
  deletingWorkspaceId,
}: WorktreeTabsProps) {
  const navigate = useNavigate()
  if (!siblings || siblings.length < 2) return null

  const handleValueChange = (next: string) => {
    if (next === activeValue) return
    const sibling = siblings.find((item) => String(item.id) === next || item.workspaceId === next)
    if (sibling?.workspaceId) {
      onSelectWorkspace?.(sibling.workspaceId)
      return
    }
    navigate(`/repos/${next}`)
  }

  return (
    <div className="px-4 pt-2 flex-shrink-0">
      <Tabs value={activeValue} onValueChange={handleValueChange}>
        <TabsList className="w-full overflow-x-auto justify-start">
          {siblings.map((sibling) => {
            const label = sibling.currentBranch || sibling.branch || sibling.workspaceName || sibling.defaultBranch || 'main'
            const value = sibling.workspaceId ?? String(sibling.id)
            return (
              <div key={value} className="flex items-center">
                <TabsTrigger
                  value={value}
                  className="gap-1.5"
                >
                  <GitBranch
                    className={`h-3 w-3 ${sibling.isWorktree ? 'text-purple-400' : ''}`}
                  />
                  <span className="truncate max-w-[140px]">{label}</span>
                </TabsTrigger>
                {sibling.workspaceId && onDeleteWorkspace ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="ml-1 h-5 w-5 text-muted-foreground hover:text-destructive"
                    disabled={deletingWorkspaceId === sibling.workspaceId}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteWorkspace(sibling.workspaceId!)
                    }}
                    aria-label={`Delete workspace ${label}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                ) : null}
              </div>
            )
          })}
        </TabsList>
      </Tabs>
    </div>
  )
}
