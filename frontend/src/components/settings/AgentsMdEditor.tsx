import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeEditor } from '@/components/ui/code-editor'
import { EditorFindBar } from '@/components/ui/editor-find-bar'
import { useFindInText } from '@/lib/useFindInText'
import { settingsApi } from '@/api/settings'
import { showToast } from '@/lib/toast'

export function AgentsMdEditor() {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const hasChanges = content !== savedContent
  const hasChangesRef = useRef(false)
  hasChangesRef.current = hasChanges
  const savedContentRef = useRef('')
  savedContentRef.current = savedContent

  const { data, isLoading, error } = useQuery({
    queryKey: ['agents-md'],
    queryFn: () => settingsApi.getAgentsMd(),
  })

  useEffect(() => {
    if (data?.content === undefined) return
    if (hasChangesRef.current) return
    if (data.content === savedContentRef.current) return
    setContent(data.content)
    setSavedContent(data.content)
  }, [data?.content])

  const updateMutation = useMutation({
    mutationFn: (newContent: string) => settingsApi.updateAgentsMd(newContent),
    onSuccess: (_data, newContent) => {
      setSavedContent(newContent)
      queryClient.invalidateQueries({ queryKey: ['agents-md'] })
      queryClient.invalidateQueries({ queryKey: ['opencode', 'agents'] })
      showToast.success('AGENTS.md saved and server restarted')
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
      setSavedContent(defaultContent)
      showToast.success('AGENTS.md reset to default and server restarted')
    },
    onError: () => {
      showToast.error('Failed to reset AGENTS.md')
    },
  })

  const isSaving = updateMutation.isPending || resetToDefaultMutation.isPending

  const handleSave = () => {
    updateMutation.mutate(content)
  }

  const handleResetToDefault = () => {
    resetToDefaultMutation.mutate()
  }

  const { query, setQuery, matches, currentMatchIndex, hasMatches, next, prev } = useFindInText(content)

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
      <div className="sticky top-0 z-10 flex flex-col gap-3 bg-background py-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Global instructions for AI agents. This file is merged with repository-specific AGENTS.md files.
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetToDefault}
            disabled={isSaving}
            className="flex-1 sm:flex-none"
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
            disabled={!hasChanges || isSaving}
            className="flex-1 sm:flex-none"
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

      <EditorFindBar
        query={query}
        onQueryChange={setQuery}
        matchCount={matches.length}
        currentMatch={hasMatches ? currentMatchIndex + 1 : 0}
        onPrev={prev}
        onNext={next}
        inputName="agents-md-find"
        placeholder="Find in AGENTS.md..."
        className="rounded-t-md border-x border-t"
      />

      <div className="h-[55vh] min-h-[300px] overflow-hidden rounded-b-md border border-input">
        <CodeEditor
          ariaLabel="AGENTS.md content"
          value={content}
            onChange={setContent}
          highlights={matches}
          activeHighlightIndex={currentMatchIndex}
          disabled={isSaving}
          placeholder="# Agent Instructions&#10;&#10;Add global instructions for AI agents here..."
        />
      </div>

      {hasChanges && (
        <p className="text-xs text-amber-500">You have unsaved changes</p>
      )}
    </div>
  )
}
