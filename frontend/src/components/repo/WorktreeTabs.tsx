import { useNavigate } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitBranch } from 'lucide-react'
import type { RepoSibling } from '@/api/repos'

interface WorktreeTabsProps {
  siblings: RepoSibling[]
  activeRepoId: number
}

export function WorktreeTabs({ siblings, activeRepoId }: WorktreeTabsProps) {
  const navigate = useNavigate()
  if (!siblings || siblings.length < 2) return null

  const activeValue = String(activeRepoId)

  const handleValueChange = (next: string) => {
    if (next === activeValue) return
    navigate(`/repos/${next}`)
  }

  return (
    <div className="px-4 pt-2 flex-shrink-0">
      <Tabs value={activeValue} onValueChange={handleValueChange}>
        <TabsList className="w-full overflow-x-auto justify-start">
          {siblings.map((sibling) => {
            const label = sibling.currentBranch || sibling.branch || sibling.defaultBranch || 'main'
            return (
              <TabsTrigger
                key={sibling.id}
                value={String(sibling.id)}
                className="gap-1.5"
              >
                <GitBranch
                  className={`h-3 w-3 ${sibling.isWorktree ? 'text-purple-400' : ''}`}
                />
                <span className="truncate max-w-[140px]">{label}</span>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>
    </div>
  )
}
