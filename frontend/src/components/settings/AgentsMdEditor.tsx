import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'

export function AgentsMdEditor() {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const [hasChanges, setHasChanges] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['agents-md'],
    queryFn: () => settingsApi.getAgentsMd(),
  })

  useEffect(() => {
    if (data?.content !== undefined) {
      setContent(data.content)
      setHasChanges(false)
    }
  }, [data?.content])

  const updateMutation = useMutation({
    mutationFn: (newContent: string) => settingsApi.updateAgentsMd(newContent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents-md'] })
      setHasChanges(false)
      showToast.success('AGENTS.md saved successfully')
    },
    onError: () => {
      showToast.error('Failed to save AGENTS.md')
    },
  })

  const resetToDefaultMutation = useMutation({
    mutationFn: async () => {
      const { content: defaultContent } = await settingsApi.getDefaultAgentsMd()
      await settingsApi.updateAgentsMd(defaultContent)
      return defaultContent
    },
    onSuccess: (defaultContent) => {
      queryClient.invalidateQueries({ queryKey: ['agents-md'] })
      setContent(defaultContent)
      setHasChanges(false)
      showToast.success('AGENTS.md reset to default')
    },
    onError: () => {
      showToast.error('Failed to reset AGENTS.md')
    },
  })

  const handleContentChange = (value: string) => {
    setContent(value)
    setHasChanges(value !== data?.content)
  }

  const handleSave = () => {
    updateMutation.mutate(content)
  }

  const handleResetToDefault = () => {
    resetToDefaultMutation.mutate()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        Failed to load AGENTS.md
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Global instructions for AI agents. This file is merged with repository-specific AGENTS.md files.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetToDefault}
            disabled={updateMutation.isPending || resetToDefaultMutation.isPending}
          >
            {resetToDefaultMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-1" />
            )}
            Reset to Default
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending || resetToDefaultMutation.isPending}
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>
      
      <Textarea
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        className="font-mono text-sm min-h-[300px] resize-y"
        placeholder="# Agent Instructions&#10;&#10;Add global instructions for AI agents here..."
      />
      
      {hasChanges && (
        <p className="text-xs text-amber-500">You have unsaved changes</p>
      )}
    </div>
  )
}
