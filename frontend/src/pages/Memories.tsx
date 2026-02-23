import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getRepo } from '@/api/repos'
import { useProjectSummary } from '@/hooks/useMemories'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Plus, Brain } from 'lucide-react'
import { getRepoDisplayName } from '@/lib/utils'
import { MemoryList } from '@/components/memory/MemoryList'
import { MemoryFormDialog } from '@/components/memory/MemoryFormDialog'

export function Memories() {
  const { id } = useParams<{ id: string }>()
  const repoId = id ? Number(id) : undefined
  const [createOpen, setCreateOpen] = useState(false)

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ['repo', repoId],
    queryFn: () => getRepo(repoId!),
    enabled: repoId !== undefined,
  })

  const { data: projectSummary, isLoading: projectSummaryLoading } = useProjectSummary(repoId)

  const projectId = projectSummary?.projectId ?? null
  const stats = projectSummary?.stats ?? null

  if (repoLoading || projectSummaryLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-muted-foreground">Repository not found</p>
      </div>
    )
  }

  if (!projectId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-muted-foreground">No project ID found - the repository may not have any commits yet</p>
      </div>
    )
  }

  const scopeLabels: Record<string, string> = {
    convention: 'Convention',
    decision: 'Decision',
    context: 'Context',
  }

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
      <Header>
        <Header.BackButton to={`/repos/${repoId}`} />
        <div className="min-w-0 flex-1 flex justify-center ml-2">
          <Header.Title className="hidden sm:flex ">
            Memory: {getRepoDisplayName(repo.repoUrl, repo.localPath)}
          </Header.Title>
          <Header.Title className="sm:hidden truncate">
            {getRepoDisplayName(repo.repoUrl, repo.localPath)}
          </Header.Title>
        </div>
        <Header.Actions>
          <Button onClick={() => setCreateOpen(true)} size="sm" className="hidden sm:flex">
            <Plus className="w-4 h-4 mr-2" />
            New Memory
          </Button>
          <Button onClick={() => setCreateOpen(true)} size="sm" className="sm:hidden">
            <Plus className="w-4 h-4" />
          </Button>
        </Header.Actions>
      </Header>

      <div className="flex-1 overflow-auto p-4 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
        {stats && (
          <Card className="mb-6 hidden sm:block">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-blue-500" />
                <span className="font-medium">Total Memories: {stats.total}</span>
              </div>
              {Object.keys(stats.byScope).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.byScope).map(([scope, count]) => (
                    <Badge key={scope} variant="outline" className="text-sm">
                      {scopeLabels[scope] || scope}: {count}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <MemoryList projectId={projectId} showFilters={true} />
      </div>

      <MemoryFormDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  )
}
