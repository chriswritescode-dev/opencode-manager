import { Button } from '@/components/ui/button'
import { FileBrowser } from '@/components/file-browser/FileBrowser'
import { PageHeader } from '@/components/ui/page-header'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function Workspace() {
  const navigate = useNavigate()

  return (
    <div className="h-screen bg-gradient-to-br from-background via-background to-background flex flex-col">
      <PageHeader className="px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/repos')}
              className="text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-lg font-semibold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              Workspace
            </h1>
          </div>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-hidden p-4">
        <FileBrowser />
      </div>
    </div>
  )
}
