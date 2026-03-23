import { useState } from 'react'
import { Header } from '@/components/ui/header'
import { Button } from '@/components/ui/button'
import { CreateSessionDialog } from '@/components/session/CreateSessionDialog'
import { WorkspaceList } from '@/components/workspace/WorkspaceList'
import { Plus } from 'lucide-react'
import {
  useCreateSession,
  useStartSession,
} from '@/hooks/useSessions'
import { useNavigate } from 'react-router-dom'

export function SessionManager() {
  const navigate = useNavigate()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const createSession = useCreateSession()
  const startSession = useStartSession()

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-background via-background to-background flex flex-col">
      <Header>
        <Header.Title>Workspaces</Header.Title>
        <Header.Actions>
          <Button
            variant="default"
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 hover:scale-105"
          >
            <Plus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">New Workspace</span>
          </Button>
          <Header.Settings />
        </Header.Actions>
      </Header>

      <div className="flex-1 flex flex-col min-h-0">
        <WorkspaceList
          onSelectWorkspace={(id) => navigate(`/workspace/${id}`)}
        />
      </div>

      <CreateSessionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={async (data) => {
          const created = await createSession.mutateAsync(data)
          setCreateDialogOpen(false)
          if (created?.id) {
            startSession.mutate(created.id)
            navigate(`/workspace/${created.id}`)
          }
        }}
        isCreating={createSession.isPending}
      />
    </div>
  )
}
