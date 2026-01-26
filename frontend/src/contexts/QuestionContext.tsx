/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { API_BASE_URL } from '@/config'

interface QuestionOption {
  label: string
  description: string
}

interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: {
    messageID: string
    callID: string
  }
}

interface QuestionContextValue {
  currentQuestion: QuestionRequest | null
  pendingQuestions: QuestionRequest[]
  respondToQuestion: (requestId: string, answers: string[][]) => Promise<void>
  rejectQuestion: (requestId: string) => Promise<void>
  addQuestion: (question: QuestionRequest) => void
  removeQuestion: (requestId: string) => void
}

const QuestionContext = createContext<QuestionContextValue | null>(null)

export function QuestionProvider({ children }: { children: React.ReactNode }) {
  const [pendingQuestions, setPendingQuestions] = useState<QuestionRequest[]>([])
  const answeredRef = useRef<Set<string>>(new Set())

  const currentQuestion = useMemo(() => {
    return pendingQuestions[0] ?? null
  }, [pendingQuestions])

  const addQuestion = useCallback((question: QuestionRequest) => {
    if (answeredRef.current.has(question.id)) {
      return
    }
    setPendingQuestions((prev) => {
      if (prev.some((q) => q.id === question.id)) {
        return prev
      }
      return [...prev, question]
    })
  }, [])

  const removeQuestion = useCallback((requestId: string) => {
    answeredRef.current.add(requestId)
    setPendingQuestions((prev) => prev.filter((q) => q.id !== requestId))
  }, [])

  const respondToQuestion = useCallback(async (requestId: string, answers: string[][]) => {
    const question = pendingQuestions.find((q) => q.id === requestId)
    if (!question) {
      throw new Error('Question not found')
    }

    const response = await fetch(`${API_BASE_URL}/api/opencode/question/${requestId}/reply?directory=${encodeURIComponent(question.sessionID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to respond to question: ${text}`)
    }

    removeQuestion(requestId)
  }, [pendingQuestions, removeQuestion])

  const rejectQuestion = useCallback(async (requestId: string) => {
    const question = pendingQuestions.find((q) => q.id === requestId)
    if (!question) {
      throw new Error('Question not found')
    }

    const response = await fetch(`${API_BASE_URL}/api/opencode/question/${requestId}/reject?directory=${encodeURIComponent(question.sessionID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to reject question: ${text}`)
    }

    removeQuestion(requestId)
  }, [pendingQuestions, removeQuestion])

  useEffect(() => {
    const fetchPendingQuestions = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/opencode/question`)
        if (response.ok) {
          const data = await response.json()
          if (Array.isArray(data)) {
            data.forEach((q: QuestionRequest) => addQuestion(q))
          }
        }
      } catch {
        // Ignore errors during initial fetch
      }
    }

    fetchPendingQuestions()
  }, [addQuestion])

  useEffect(() => {
    const unsubscribe = questionEvents.subscribe(addQuestion)
    return unsubscribe
  }, [addQuestion])

  const value: QuestionContextValue = useMemo(
    () => ({
      currentQuestion,
      pendingQuestions,
      respondToQuestion,
      rejectQuestion,
      addQuestion,
      removeQuestion,
    }),
    [currentQuestion, pendingQuestions, respondToQuestion, rejectQuestion, addQuestion, removeQuestion]
  )

  return <QuestionContext.Provider value={value}>{children}</QuestionContext.Provider>
}

export function useQuestionContext() {
  const context = useContext(QuestionContext)
  if (!context) {
    throw new Error('useQuestionContext must be used within QuestionProvider')
  }
  return context
}

export const questionEvents = {
  listeners: new Set<(question: QuestionRequest) => void>(),
  emit(question: QuestionRequest) {
    this.listeners.forEach((listener) => listener(question))
  },
  subscribe(listener: (question: QuestionRequest) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  },
}
