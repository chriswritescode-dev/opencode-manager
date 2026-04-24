import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { getRepo } from "@/api/repos"
import { useAssistantSessionLauncher } from "@/hooks/useAssistantSessionLauncher"
import { OPENCODE_API_ENDPOINT } from "@/config"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

export function AssistantRedirect() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const repoId = Number(id) || 0
  const hasStartedRef = useRef(false)
  const [status, setStatus] = useState<"preparing" | "opening" | "creating" | "error">("preparing")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const opcodeUrl = OPENCODE_API_ENDPOINT

  const handleNavigate = useCallback((sessionId: string) => {
    setStatus("opening")
    navigate(`/repos/${repoId}/sessions/${sessionId}`)
  }, [navigate, repoId])

  const { openAssistant } = useAssistantSessionLauncher({
    repoId,
    opcodeUrl,
    onNavigate: handleNavigate,
  })

  useEffect(() => {
    let cancelled = false

    async function loadAndOpen() {
      try {
        if (hasStartedRef.current) return
        hasStartedRef.current = true
        setStatus("preparing")
        await getRepo(repoId)
        if (cancelled) return
        setStatus("creating")
        await openAssistant()
      } catch (error) {
        if (cancelled) return
        setStatus("error")
        hasStartedRef.current = false
        setErrorMessage(error instanceof Error ? error.message : "Failed to open Assistant")
      }
    }

    loadAndOpen()

    return () => {
      cancelled = true
    }
  }, [repoId, openAssistant])

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center max-w-md px-4">
        {status === "error" ? (
          <>
            <p className="text-muted-foreground mb-4">{errorMessage}</p>
            <Button
              onClick={() => navigate(`/repos/${repoId}`)}
              variant="outline"
            >
              Go Back
            </Button>
            <Button
              onClick={() => window.location.reload()}
              className="ml-2"
            >
              Retry
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {status === "preparing" && "Preparing Assistant workspace..."}
              {status === "creating" && "Starting a new Assistant session..."}
              {status === "opening" && "Opening your last Assistant session..."}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
