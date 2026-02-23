import { useState } from 'react'
import { useMemories, useDeleteMemory } from '@/hooks/useMemories'
import { useDebounce } from '@/hooks/useDebounce'
import type { Memory } from '@opencode-manager/shared/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Loader2, Trash2, Edit, Search } from 'lucide-react'
import { MemoryFormDialog } from './MemoryFormDialog'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface MemoryListProps {
  projectId?: string
  scope?: string
  showFilters?: boolean
}

const scopeColors: Record<string, string> = {
  convention: 'bg-blue-600/20 text-blue-400 border-blue-600/40',
  decision: 'bg-green-600/20 text-green-400 border-green-600/40',
  context: 'bg-purple-600/20 text-purple-400 border-purple-600/40',
}

export function MemoryList({ projectId, scope, showFilters = true }: MemoryListProps) {
  const [filterScope, setFilterScope] = useState<string>(scope || 'all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const [editMemory, setEditMemory] = useState<Memory | null>(null)
  const [deleteMemoryId, setDeleteMemoryId] = useState<number | null>(null)

  const filters = {
    projectId,
    scope: filterScope !== 'all' ? filterScope : undefined,
    ...(debouncedSearch ? { content: debouncedSearch } : undefined),
  }

  const { data: memories, isLoading } = useMemories(filters)
  const deleteMutation = useDeleteMemory()

  const handleDelete = () => {
    if (deleteMemoryId !== null) {
      deleteMutation.mutate(deleteMemoryId)
      setDeleteMemoryId(null)
    }
  }

  return (
    <div className="space-y-4">
      {showFilters && (
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />
          <Select value={filterScope} onValueChange={setFilterScope}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Scopes</SelectItem>
              <SelectItem value="convention">Convention</SelectItem>
              <SelectItem value="decision">Decision</SelectItem>
              <SelectItem value="context">Context</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : memories && memories.length === 0 ? (
        <div className="text-center p-8 text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No memories found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {memories?.map((memory) => (
            <div
              key={memory.id}
              className="p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <Badge className={`text-xs ${scopeColors[memory.scope]}`}>
                    {memory.scope}
                  </Badge>
                  {memory.filePath && (
                    <span className="text-xs text-muted-foreground truncate max-w-xs">
                      {memory.filePath}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setEditMemory(memory)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => setDeleteMemoryId(memory.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{memory.content}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Created: {new Date(memory.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {editMemory && (
        <MemoryFormDialog
          memory={editMemory}
          projectId={projectId}
          open={!!editMemory}
          onOpenChange={(open: boolean) => !open && setEditMemory(null)}
        />
      )}

      <DeleteDialog
        open={deleteMemoryId !== null}
        onOpenChange={(open: boolean) => !open && setDeleteMemoryId(null)}
        onConfirm={handleDelete}
        onCancel={() => setDeleteMemoryId(null)}
        title="Delete Memory"
        description="Are you sure you want to delete this memory? This action cannot be undone."
      />
    </div>
  )
}
