import { useState, useCallback } from 'react'
import { useQuestionContext } from '@/contexts/QuestionContext'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { HelpCircle, X, Send, Loader2 } from 'lucide-react'

export function QuestionDialog() {
  const { currentQuestion, respondToQuestion, rejectQuestion, pendingQuestions } = useQuestionContext()
  const [selectedAnswers, setSelectedAnswers] = useState<Map<number, string[]>>(new Map())
  const [customAnswers, setCustomAnswers] = useState<Map<number, string>>(new Map())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSelect = useCallback((questionIndex: number, label: string, multiple: boolean) => {
    setSelectedAnswers((prev) => {
      const current = prev.get(questionIndex) ?? []
      if (multiple) {
        if (current.includes(label)) {
          return new Map(prev).set(questionIndex, current.filter((l) => l !== label))
        }
        return new Map(prev).set(questionIndex, [...current, label])
      }
      return new Map(prev).set(questionIndex, [label])
    })
  }, [])

  const handleCustomChange = useCallback((questionIndex: number, value: string) => {
    setCustomAnswers((prev) => new Map(prev).set(questionIndex, value))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!currentQuestion) return

    setIsSubmitting(true)
    setError(null)

    try {
      const answers: string[][] = currentQuestion.questions.map((q, idx) => {
        const selected = selectedAnswers.get(idx) ?? []
        const custom = customAnswers.get(idx)?.trim()
        
        if (custom && (q.custom !== false)) {
          return [...selected, custom]
        }
        return selected
      })

      const hasAnyAnswer = answers.some((a) => a.length > 0)
      if (!hasAnyAnswer) {
        setError('Please select at least one option or provide a custom answer')
        setIsSubmitting(false)
        return
      }

      await respondToQuestion(currentQuestion.id, answers)
      setSelectedAnswers(new Map())
      setCustomAnswers(new Map())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer')
    } finally {
      setIsSubmitting(false)
    }
  }, [currentQuestion, selectedAnswers, customAnswers, respondToQuestion])

  const handleReject = useCallback(async () => {
    if (!currentQuestion) return

    setIsSubmitting(true)
    setError(null)

    try {
      await rejectQuestion(currentQuestion.id)
      setSelectedAnswers(new Map())
      setCustomAnswers(new Map())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject question')
    } finally {
      setIsSubmitting(false)
    }
  }, [currentQuestion, rejectQuestion])

  if (!currentQuestion) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-lg max-w-lg w-full max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-blue-500" />
            <h2 className="font-semibold text-foreground">Question from AI</h2>
            {pendingQuestions.length > 1 && (
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                +{pendingQuestions.length - 1} more
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={handleReject} disabled={isSubmitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-6">
          {currentQuestion.questions.map((q, qIdx) => (
            <div key={qIdx} className="space-y-3">
              <div>
                <Label className="text-sm font-medium text-muted-foreground">{q.header}</Label>
                <p className="text-foreground mt-1">{q.question}</p>
              </div>

              <div className="space-y-2">
                {q.options.map((opt, optIdx) => {
                  const isSelected = (selectedAnswers.get(qIdx) ?? []).includes(opt.label)
                  
                  return (
                    <button
                      key={optIdx}
                      type="button"
                      onClick={() => handleSelect(qIdx, opt.label, q.multiple ?? false)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-border hover:border-muted-foreground/50 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          className="mt-0.5"
                          onCheckedChange={() => handleSelect(qIdx, opt.label, q.multiple ?? false)}
                        />
                        <div>
                          <div className="font-medium text-foreground">{opt.label}</div>
                          {opt.description && (
                            <div className="text-sm text-muted-foreground">{opt.description}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {q.custom !== false && (
                <div className="pt-2">
                  <Label className="text-sm text-muted-foreground">Or type a custom answer:</Label>
                  <Input
                    value={customAnswers.get(qIdx) ?? ''}
                    onChange={(e) => handleCustomChange(qIdx, e.target.value)}
                    placeholder="Type your answer..."
                    className="mt-1"
                  />
                </div>
              )}
            </div>
          ))}

          {error && (
            <div className="text-red-500 text-sm bg-red-500/10 p-2 rounded">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <Button variant="outline" onClick={handleReject} disabled={isSubmitting}>
            Skip
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Submit
          </Button>
        </div>
      </div>
    </div>
  )
}
