import { useContextUsage } from '@/hooks/useContextUsage'
import { getModel, formatModelName } from '@/api/providers'
import { useState, useEffect } from 'react'

interface ContextUsageIndicatorProps {
  opcodeUrl: string | null
  sessionID: string | undefined
  directory?: string
}

export function ContextUsageIndicator({ opcodeUrl, sessionID, directory }: ContextUsageIndicatorProps) {
  const { totalTokens, contextLimit, usagePercentage, currentModel, isLoading } = useContextUsage(opcodeUrl, sessionID, directory)
  const [modelName, setModelName] = useState<string>('')

  useEffect(() => {
    const loadModelName = async () => {
      if (currentModel) {
        try {
          const [providerId, modelId] = currentModel.split('/')
          if (providerId && modelId) {
            const model = await getModel(providerId, modelId)
            if (model) {
              setModelName(formatModelName(model))
            } else {
              setModelName(currentModel)
            }
          } else {
            setModelName(currentModel)
          }
        } catch {
          setModelName(currentModel)
        }
      } else {
        setModelName('')
      }
    }

    loadModelName()
  }, [currentModel])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (!modelName) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">No model</span>
      </div>
    )
  }

  const getUsageColor = (percentage: number) => {
    if (percentage < 50) return 'bg-green-700 dark:bg-green-400'
    if (percentage < 80) return 'bg-yellow-700 dark:bg-yellow-400'
    return 'bg-red-700 dark:bg-red-400'
  }

  const getUsageTextColor = (percentage: number) => {
    if (percentage < 50) return 'text-green-700 dark:text-green-400'
    if (percentage < 80) return 'text-yellow-700 dark:text-yellow-400'
    return 'text-red-700 dark:text-red-400'
  }

  if (!contextLimit) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{modelName}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden border border-border">
          <div 
            className={`h-full transition-all duration-300 ${getUsageColor(usagePercentage || 0)}`}
            style={{ width: `${Math.min(usagePercentage || 0, 100)}%` }}
          />
        </div>
        <span className={`text-xs font-medium whitespace-nowrap ${getUsageTextColor(usagePercentage || 0)}`}>
          {totalTokens.toLocaleString()} / {contextLimit.toLocaleString()}
        </span>
      </div>
    </div>
  )
}