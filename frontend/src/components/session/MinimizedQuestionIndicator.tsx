import { X } from 'lucide-react'
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
    <div className="w-full bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-950 dark:to-orange-900 border-2 border-orange-300 dark:border-orange-700 rounded-lg shadow-lg mb-2 overflow-hidden">
      <div className="flex items-center px-3 py-2 sm:px-4 sm:py-2.5 border-b border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/50">
        <button
          onClick={onRestore}
          className="flex-1 text-left text-xs font-semibold text-orange-600 dark:text-white"
        >
          {questionCount === 1 
            ? `Question: ${firstQuestionHeader || 'Question pending'}`
            : `${questionCount} questions pending`
          }
        </button>
        <button
          onClick={onDismiss}
          className="p-1.5 hover:bg-red-500/20 text-muted-foreground hover:text-red-500 transition-colors hidden sm:block"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
