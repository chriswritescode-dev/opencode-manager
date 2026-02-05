import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { QuestionRequest, QuestionInfo } from '@/api/types'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'

interface QuestionPromptProps {
  question: QuestionRequest
  onReply: (requestID: string, answers: string[][]) => Promise<void>
  onReject: (requestID: string) => Promise<void>
}

export function QuestionPrompt({ question, onReply, onReject }: QuestionPromptProps) {
  const questions = question.questions
  const isSingleSelect = questions.length === 1 && !questions[0]?.multiple
  const totalSteps = isSingleSelect ? 1 : questions.length + 1

  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<string[][]>(() => questions.map(() => []))
  const [customInputs, setCustomInputs] = useState<string[]>(() => questions.map(() => ''))
  const [confirmedCustoms, setConfirmedCustoms] = useState<string[]>(() => questions.map(() => ''))
  const [expandedOther, setExpandedOther] = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isConfirmStep = !isSingleSelect && currentIndex === questions.length
  const currentQuestion = isConfirmStep ? null : questions[currentIndex]
  const isMultiSelect = currentQuestion?.multiple === true

  const goToNext = useCallback(() => {
    if (currentIndex < totalSteps - 1) {
      setCurrentIndex(prev => prev + 1)
      setExpandedOther(null)
    }
  }, [currentIndex, totalSteps])

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1)
      setExpandedOther(null)
    }
  }, [currentIndex])

  const handleSubmitSingle = useCallback(async (label: string) => {
    setIsSubmitting(true)
    try {
      await onReply(question.id, [[label]])
    } catch {
      showToast.error('Failed to submit answer')
    } finally {
      setIsSubmitting(false)
    }
  }, [onReply, question.id])

  const selectOption = useCallback((questionIndex: number, label: string) => {
    const isMultiple = questions[questionIndex]?.multiple
    
    setAnswers(prev => {
      const updated = [...prev]
      const current = updated[questionIndex] ?? []
      
      if (isMultiple) {
        const exists = current.includes(label)
        updated[questionIndex] = exists 
          ? current.filter(l => l !== label)
          : [...current, label]
      } else {
        updated[questionIndex] = [label]
      }
      return updated
    })

    if (!isMultiple) {
      if (isSingleSelect) {
        handleSubmitSingle(label)
      } else {
        setTimeout(() => goToNext(), 150)
      }
    }
  }, [questions, isSingleSelect, goToNext, handleSubmitSingle])

  const handleCustomInput = useCallback((questionIndex: number, value: string) => {
    setCustomInputs(prev => {
      const updated = [...prev]
      updated[questionIndex] = value
      return updated
    })
  }, [])

  const handleExpandOther = useCallback((questionIndex: number) => {
    if (!isMultiSelect) {
      setAnswers(prev => {
        const updated = [...prev]
        updated[questionIndex] = []
        return updated
      })
    }
    setConfirmedCustoms(prev => {
      const updated = [...prev]
      updated[questionIndex] = ''
      return updated
    })
    setExpandedOther(questionIndex)
  }, [isMultiSelect])

  const confirmCustomInput = useCallback((questionIndex: number) => {
    const value = customInputs[questionIndex]?.trim()
    if (!value) {
      setExpandedOther(null)
      return
    }

    const oldCustom = confirmedCustoms[questionIndex]
    
    setAnswers(prev => {
      const updated = [...prev]
      const current = updated[questionIndex] ?? []
      
      if (questions[questionIndex]?.multiple) {
        const withoutOld = oldCustom ? current.filter(l => l !== oldCustom) : current
        updated[questionIndex] = [...withoutOld, value]
      } else {
        updated[questionIndex] = [value]
        if (!isSingleSelect) {
          setTimeout(() => goToNext(), 150)
        }
      }
      return updated
    })
    
    setConfirmedCustoms(prev => {
      const updated = [...prev]
      updated[questionIndex] = value
      return updated
    })
    setExpandedOther(null)
    
    if (isSingleSelect) {
      handleSubmitSingle(value)
    }
  }, [customInputs, confirmedCustoms, questions, isSingleSelect, goToNext, handleSubmitSingle])

  const handleNext = useCallback(() => {
    if (expandedOther === currentIndex) {
      confirmCustomInput(currentIndex)
    } else {
      goToNext()
    }
  }, [expandedOther, currentIndex, confirmCustomInput, goToNext])

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await onReply(question.id, answers)
    } catch {
      showToast.error('Failed to submit answers')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    setIsSubmitting(true)
    try {
      await onReject(question.id)
    } catch {
      showToast.error('Failed to dismiss question')
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasAnswerForQuestion = (index: number) => {
    return (answers[index]?.length ?? 0) > 0
  }

  const allQuestionsAnswered = questions.every((_, i) => hasAnswerForQuestion(i))

  return (
    <div 
      className="w-full bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-2 border-blue-500/30 rounded-xl shadow-lg shadow-blue-500/10 backdrop-blur-sm mb-3 overflow-hidden"
    >
      <div className="flex items-center justify-between px-2 py-1.5 sm:px-3 sm:py-2 border-b border-blue-500/20 bg-blue-500/5">
        <div className="flex items-center gap-2">
          {totalSteps > 1 && (
            <button
              onClick={goToPrev}
              disabled={currentIndex === 0}
              className="p-0.5 sm:p-1 rounded hover:bg-blue-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 dark:text-blue-400" />
            </button>
          )}
          <span className="text-xs sm:text-sm font-semibold text-blue-400">
            {isConfirmStep ? 'Review' : (
              totalSteps > 1 
                ? `Question ${currentIndex + 1}/${questions.length}` 
                : (currentQuestion?.header || 'Question')
            )}
          </span>
          {totalSteps > 1 && (
            <button
              onClick={goToNext}
              disabled={currentIndex === totalSteps - 1}
              className="p-0.5 sm:p-1 rounded hover:bg-blue-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 dark:text-blue-400" />
            </button>
          )}
        </div>
        <button
          onClick={handleReject}
          disabled={isSubmitting}
          className="p-1 sm:p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-500 transition-colors"
        >
          <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </div>

      <div className="p-2 sm:p-3 max-h-[50vh] sm:max-h-[70vh] overflow-y-auto overflow-x-hidden">
        {isConfirmStep ? (
          <ConfirmStep 
            questions={questions} 
            answers={answers} 
            onEditQuestion={setCurrentIndex}
          />
        ) : currentQuestion && (
          <QuestionStep
            question={currentQuestion}
            answers={answers[currentIndex] ?? []}
            customInput={customInputs[currentIndex] ?? ''}
            confirmedCustom={confirmedCustoms[currentIndex] ?? ''}
            expandedOther={expandedOther === currentIndex}
            isMultiSelect={isMultiSelect}
            onSelectOption={(label) => selectOption(currentIndex, label)}
            onExpandOther={() => handleExpandOther(currentIndex)}
            onCustomInputChange={(value) => handleCustomInput(currentIndex, value)}
            onConfirmCustomInput={() => confirmCustomInput(currentIndex)}
            onCollapseOther={() => setExpandedOther(null)}
          />
        )}
      </div>

      {totalSteps > 1 && (
        <div className="flex justify-center gap-1 sm:gap-1.5 py-1.5 sm:py-2 border-t border-blue-500/10">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <button
              key={i}
              onClick={() => {
                setCurrentIndex(i)
                setExpandedOther(null)
              }}
              className={cn(
                "w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full transition-all duration-200",
                i === currentIndex 
                  ? "bg-blue-500 scale-125" 
                  : i < questions.length && hasAnswerForQuestion(i)
                    ? "bg-green-500/70 hover:bg-green-500"
                    : "bg-blue-500/30 hover:bg-blue-500/50"
              )}
            />
          ))}
        </div>
      )}

      <div className="flex gap-1.5 sm:gap-2 px-2 pb-2 sm:px-3 sm:pb-3">
        <Button
          size="sm"
          onClick={handleReject}
          disabled={isSubmitting}
          className="flex-1 h-8 sm:h-10 text-xs sm:text-sm bg-muted hover:bg-muted/80 text-foreground"
        >
          Dismiss
        </Button>
        {!isSingleSelect && (
          isConfirmStep ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || !allQuestionsAnswered}
              className="flex-1 h-8 sm:h-10 text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                'Submit'
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleNext}
              disabled={currentIndex === totalSteps - 1 || (expandedOther === currentIndex && !customInputs[currentIndex]?.trim())}
              className="flex-1 h-8 sm:h-10 text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <span className="hidden sm:inline">{expandedOther === currentIndex ? 'Confirm' : (currentIndex === questions.length - 1 ? 'Review' : 'Next')}</span>
              <span className="sm:hidden">{expandedOther === currentIndex ? 'OK' : (currentIndex === questions.length - 1 ? 'Review' : '→')}</span>
              <ChevronRight className="hidden sm:block w-4 h-4 ml-1" />
            </Button>
          )
        )}
      </div>

      
    </div>
  )
}

interface QuestionStepProps {
  question: QuestionInfo
  answers: string[]
  customInput: string
  confirmedCustom: string
  expandedOther: boolean
  isMultiSelect: boolean
  onSelectOption: (label: string) => void
  onExpandOther: () => void
  onCustomInputChange: (value: string) => void
  onConfirmCustomInput: () => void
  onCollapseOther: () => void
}

function QuestionStep({
  question,
  answers,
  customInput,
  confirmedCustom,
  expandedOther,
  isMultiSelect,
  onSelectOption,
  onExpandOther,
  onCustomInputChange,
  onConfirmCustomInput,
  onCollapseOther,
}: QuestionStepProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (expandedOther && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [expandedOther])

  const isCustomSelected = confirmedCustom && answers.includes(confirmedCustom)

  return (
    <div className="space-y-2 sm:space-y-3">
      <p className="text-xs sm:text-sm font-semibold text-foreground">
        {question.question}
        {isMultiSelect && (
          <span className="text-foreground/60 font-normal ml-1">(select all that apply)</span>
        )}
      </p>

      <div className="space-y-1.5 sm:space-y-2">
        {question.options.map((option, i) => {
          const isSelected = answers.includes(option.label)
          return (
            <button
              key={i}
              onClick={() => onSelectOption(option.label)}
              className={cn(
                "w-full text-left p-2 sm:p-3 rounded-lg border-2 transition-all duration-200 active:scale-[0.98]",
                isSelected
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-border hover:border-blue-500/50 hover:bg-blue-500/5"
              )}
            >
              <div className="flex items-start justify-between gap-1.5 sm:gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className={cn(
                    "w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                    isSelected 
                      ? "border-blue-500 bg-blue-500" 
                      : "border-muted-foreground"
                  )}>
                    {isSelected && <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />}
                  </div>
                  <span className={cn(
                    "text-xs sm:text-sm font-semibold",
                    isSelected ? "text-blue-400" : "text-foreground"
                  )}>
                    {option.label}
                  </span>
                </div>
              </div>
              {option.description && (
                <p className="text-[10px] sm:text-xs text-foreground/70 mt-0.5 sm:mt-1 ml-5 sm:ml-7">
                  {option.description}
                </p>
              )}
            </button>
          )
        })}

        <button
          onClick={() => {
            if (expandedOther) {
              onCollapseOther()
            } else {
              onExpandOther()
            }
          }}
          className={cn(
            "w-full text-left p-2 sm:p-3 rounded-lg border-2 transition-all duration-200",
            expandedOther || isCustomSelected
              ? "border-blue-500 bg-blue-500/10"
              : "border-border hover:border-blue-500/50 hover:bg-blue-500/5"
          )}
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className={cn(
              "w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
              isCustomSelected
                ? "border-blue-500 bg-blue-500" 
                : "border-muted-foreground"
            )}>
              {isCustomSelected && <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />}
            </div>
            <span className={cn(
              "text-xs sm:text-sm font-semibold",
              expandedOther || isCustomSelected ? "text-blue-400" : "text-foreground"
            )}>
              Other...
            </span>
          </div>
        </button>

        {expandedOther && (
          <div className="ml-5 sm:ml-7 space-y-1.5 sm:space-y-2 animate-in slide-in-from-top-2 duration-200">
            <Textarea
              ref={textareaRef}
              value={customInput}
              onChange={(e) => onCustomInputChange(e.target.value)}
              placeholder="Type your own answer..."
              className="min-h-[60px] sm:min-h-[80px] text-xs sm:text-sm resize-none border-blue-500/30 focus:border-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onConfirmCustomInput()
                }
                if (e.key === 'Escape') {
                  onCollapseOther()
                }
              }}
            />
          </div>
        )}

        {!expandedOther && isCustomSelected && (
          <div className="ml-5 sm:ml-7 text-[10px] sm:text-xs text-muted-foreground">
            {confirmedCustom}
          </div>
        )}
      </div>
    </div>
  )
}

interface ConfirmStepProps {
  questions: QuestionInfo[]
  answers: string[][]
  onEditQuestion: (index: number) => void
}

function ConfirmStep({ questions, answers, onEditQuestion }: ConfirmStepProps) {
  return (
    <div className="space-y-2 sm:space-y-3">
      <p className="text-xs sm:text-sm font-semibold text-foreground">Review your answers</p>
      
      <div className="space-y-1.5 sm:space-y-2">
        {questions.map((q, i) => {
          const answer = answers[i] ?? []
          const hasAnswer = answer.length > 0
          return (
            <button
              key={i}
              onClick={() => onEditQuestion(i)}
              className={cn(
                "w-full text-left p-2 sm:p-3 rounded-lg border transition-colors",
                hasAnswer 
                  ? "border-green-500/40 bg-green-500/10 hover:bg-green-500/15" 
                  : "border-red-500/40 bg-red-500/10 hover:bg-red-500/15"
              )}
            >
              <div className="flex items-start justify-between gap-1.5 sm:gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] sm:text-xs text-foreground/60 truncate">{q.header}</p>
                  <p className={cn(
                    "text-xs sm:text-sm font-semibold mt-0.5",
                    hasAnswer ? "text-green-400" : "text-red-400"
                  )}>
                    {hasAnswer ? answer.join(', ') : '(not answered)'}
                  </p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-foreground/50 flex-shrink-0 mt-0.5 sm:mt-1" />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
