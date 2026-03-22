import { ChevronUp, X } from 'lucide-react'
import type { QuestionRequest } from '@/api/types'

interface MinimizedQuestionIndicatorProps {
  question: QuestionRequest
  onRestore: () => void
  onDismiss: () => void
}

export function MinimizedQuestionIndicator({ 
  question, 
  onRestore, 
  onDismiss 
}: MinimizedQuestionIndicatorProps) {
  const questionCount = question.questions.length
  const firstQuestionHeader = question.questions[0]?.header
  
  return (
    <div className="w-full bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-950 dark:to-blue-900 border-2 border-blue-300 dark:border-blue-700 rounded-xl shadow-lg mb-3 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-semibold text-blue-600 dark:text-white">
            {questionCount === 1 
              ? (firstQuestionHeader || 'Question pending')
              : `${questionCount} questions pending`
            }
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRestore}
            className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 transition-colors"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
