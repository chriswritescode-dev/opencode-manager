import { useContextUsage } from '@/hooks/useContextUsage'
import { getModel, formatModelName } from '@/api/providers'
import { useState, useEffect } from 'react'

interface ContextUsageIndicatorProps {
  opcodeUrl: string | null
  sessionID: string | undefined
  directory?: string
  isConnected: boolean
  isReconnecting?: boolean
}

export function ContextUsageIndicator({ opcodeUrl, sessionID, directory, isConnected, isReconnecting }: ContextUsageIndicatorProps) {
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

  if (isReconnecting) {
    return <span className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">Reconnecting...</span>
  }

  if (!isConnected) {
    return <span className="text-xs text-muted-foreground font-medium">Disconnected</span>
  }

  if (!modelName) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">No model</span>
      </div>
    )
  }

  const getUsageTextColor = (percentage: number) => {
    if (percentage < 50) return 'text-green-700 dark:text-green-400'
    if (percentage < 80) return 'text-yellow-700 dark:text-yellow-400'
    return 'text-red-700 dark:text-red-400'
  }

  if (isReconnecting) {
    return null
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
        <span className={`text-xs font-medium whitespace-nowrap ${getUsageTextColor(usagePercentage || 0)}`}>
          {totalTokens.toLocaleString()} / {contextLimit.toLocaleString()}
        </span>
      </div>
    </div>
  )
}