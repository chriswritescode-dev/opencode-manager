import { AlertCircle, Loader2 } from 'lucide-react'
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
        <p className="text-sm">No skills available</p>
        <p className="text-xs mt-1">Skills will appear here when configured in the project's .opencode/skills/ directory</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-2 sm:px-4 py-2">
      <div className="space-y-2">
        {data.map((skill) => (
          <div
            key={skill.name}
            className="p-2 rounded-lg border border-border bg-card"
          >
            <p className="text-sm font-medium truncate">
              {formatSkillName(skill.name)}
            </p>
            {skill.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {skill.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
