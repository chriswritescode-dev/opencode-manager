import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CopyButton } from '@/components/ui/copy-button'
import { TextPart } from '@/components/message/TextPart'
import { askSideQuestion } from '@/api/opencode'

interface SideQuestionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionID: string
  initialQuestion?: string
}

export function SideQuestionDialog({
  open,
  onOpenChange,
  sessionID,
  initialQuestion = '',
}: SideQuestionDialogProps) {
  const [question, setQuestion] = useState(initialQuestion)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const requestRef = useRef(0)
  const lastQuestionRef = useRef('')

  const ask = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    lastQuestionRef.current = trimmed

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const requestId = ++requestRef.current

    setPending(true)
    setError(false)
    setAnswer('')

    try {
      const result = await askSideQuestion(sessionID, trimmed, controller.signal)
      if (requestRef.current !== requestId || controller.signal.aborted) return
      setAnswer(result)
      setPending(false)
    } catch {
      if (requestRef.current !== requestId || controller.signal.aborted) return
      setError(true)
      setPending(false)
    }
  }, [sessionID])

  useEffect(() => {
    if (initialQuestion.trim()) {
      void ask(initialQuestion)
    }
    return () => {
      controllerRef.current?.abort()
    }
  }, [ask, initialQuestion])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void ask(question)
  }

  const handleRetry = () => {
    void ask(lastQuestionRef.current)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <div className="flex items-center gap-2 pr-6">
          <DialogTitle className="flex-1">Side question</DialogTitle>
          {answer && !pending && <CopyButton content={answer} title="Copy answer" />}
        </div>
        <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-4">
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a side question"
            autoFocus
          />
          <Button type="submit" disabled={!question.trim()}>
            Ask
          </Button>
        </form>
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Thinking...</span>
          </div>
        )}
        {error && !pending && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-destructive">Failed to get an answer</span>
            <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
              Retry
            </Button>
          </div>
        )}
        {answer && !pending && (
          <div className="min-w-0 max-h-[50vh] overflow-y-auto">
            <TextPart text={answer} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
