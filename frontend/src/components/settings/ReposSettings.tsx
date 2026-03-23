import { useState } from 'react'
import { RepoList } from '@/components/repo/RepoList'
import { AddRepoDialog } from '@/components/repo/AddRepoDialog'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export function ReposSettings() {
  const [addRepoOpen, setAddRepoOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">Settings / Repos</div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Repositories</h3>
          <p className="text-sm text-muted-foreground">Manage connected repositories</p>
        </div>
        <Button size="sm" onClick={() => setAddRepoOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />
          Add Repo
        </Button>
      </div>
      <div className="border border-border rounded-lg p-3 bg-card">
        <RepoList />
      </div>
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
    </div>
  )
}
