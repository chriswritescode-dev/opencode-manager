import { Badge } from '@/components/ui/badge'
import { AlertCircle, Loader2, Sparkles } from 'lucide-react'
import type { SkillFileInfo } from '@opencode-manager/shared'

interface RepoSkillsListProps {
  isLoading: boolean
  data: SkillFileInfo[] | undefined
  error: Error | null
}

export function RepoSkillsList({ isLoading, data, error }: RepoSkillsListProps) {
  const formatSkillName = (name: string): string => {
    const formatted = name.replace(/-/g, ' ')
    return formatted.charAt(0).toUpperCase() + formatted.slice(1)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" />
        <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50 text-red-500" />
        <p className="text-sm">Failed to load skills</p>
        <p className="text-xs mt-1">{error.message}</p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No skills available</p>
        <p className="text-xs mt-1">Skills will appear here when configured in Settings or in the project's .opencode/skills/ directory</p>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-6 py-3 sm:py-4 flex-1 overflow-y-auto min-h-0">
      <div className="space-y-3">
        {data.map((skill) => (
          <div
            key={`${skill.scope}-${skill.name}`}
            className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-card"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-medium truncate">
                  {formatSkillName(skill.name)}
                </p>
                <Badge variant={skill.scope === 'global' ? 'secondary' : 'outline'} className="text-xs">
                  {skill.scope === 'global' ? 'Global' : 'Project'}
                </Badge>
              </div>
              {skill.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {skill.description}
                </p>
              )}
              {skill.scope === 'project' && skill.repoName && (
                <p className="text-xs text-muted-foreground mt-1">
                  Repo: {skill.repoName}
                </p>
              )}
              {skill.body && (
                <div className="text-xs font-mono bg-muted rounded p-2 mt-2 line-clamp-2 max-h-[40px] overflow-hidden whitespace-pre-wrap">
                  {skill.body}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
