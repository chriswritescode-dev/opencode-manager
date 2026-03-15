import { useState } from 'react'
import { useKvEntries, useDeleteKvEntry } from '@/hooks/useMemories'
import { useDebounce } from '@/hooks/useDebounce'
import type { KvEntry } from '@opencode-manager/shared/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Loader2, Trash2, Key, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { KvFormDialog } from './KvFormDialog'

interface KvListProps {
  projectId?: string
}

function formatTimeRemaining(expiresAt: number): string {
  const now = Date.now()
  const diff = expiresAt - now

  if (diff <= 0) {
    return 'expired'
  }

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${minutes}m`
}

export function KvList({ projectId }: KvListProps) {
  const [searchQuery, setSearchQuery] = useState<string>('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [deleteKey, setDeleteKey] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<KvEntry | undefined>(undefined)

  const { data: entries, isLoading } = useKvEntries(projectId, debouncedSearch || undefined)
  const deleteMutation = useDeleteKvEntry()

  const handleDelete = () => {
    if (deleteKey && projectId) {
      deleteMutation.mutate({ projectId, key: deleteKey })
      setDeleteKey(null)
    }
  }

  const toggleExpand = (key: string) => {
    setExpandedKey(expandedKey === key ? null : key)
  }

  const handleEdit = (entry: KvEntry) => {
    setEditingEntry(entry)
    setDialogOpen(true)
  }

  const handleCreate = () => {
    setEditingEntry(undefined)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by key prefix..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-64"
        />
        <Button onClick={handleCreate} size="sm">
          <Plus className="w-4 h-4 mr-2" />
          Add KV Entry
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !entries || entries.length === 0 ? (
        <div className="text-center p-8 text-muted-foreground">
          <Key className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No KV entries found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry: KvEntry) => {
            const isExpanded = expandedKey === entry.key
            const dataPreview = JSON.stringify(entry.data)
            const formattedData = JSON.stringify(entry.data, null, 2)
            const truncatedPreview = dataPreview.length > 100
              ? dataPreview.slice(0, 100) + '...'
              : dataPreview

            return (
              <div
                key={entry.key}
                className="p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 p-0"
                      onClick={() => toggleExpand(entry.key)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </Button>
                    <span className="font-medium truncate">{entry.key}</span>
                    <Badge
                      variant="outline"
                      className="text-xs bg-amber-600/20 text-amber-400 border-amber-600/40"
                    >
                      {formatTimeRemaining(entry.expiresAt)}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleEdit(entry)}
                    >
                      <Key className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setDeleteKey(entry.key)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground font-mono break-all">
                  {truncatedPreview}
                </div>
                {isExpanded && (
                  <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-64">
                    {formattedData}
                  </pre>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Updated: {new Date(entry.updatedAt).toLocaleString()}
                </p>
              </div>
            )
          })}
        </div>
      )}

      <DeleteDialog
        open={deleteKey !== null}
        onOpenChange={(open: boolean) => !open && setDeleteKey(null)}
        onConfirm={handleDelete}
        onCancel={() => setDeleteKey(null)}
        title="Delete KV Entry"
        description="Are you sure you want to delete this KV entry? This action cannot be undone."
        itemName={deleteKey || undefined}
        isDeleting={deleteMutation.isPending}
      />

      <KvFormDialog
        entry={editingEntry}
        projectId={projectId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}
