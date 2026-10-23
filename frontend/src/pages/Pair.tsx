import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import { showToast } from '@/lib/toast'
import { readPairingCodeFromHash } from '@opencode-manager/shared/schemas'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { getSession } from '@/lib/auth-client'

type PairState = 'redeeming' | 'missing' | 'error'

/** Signs the browser in from a `/pair#c=<code>` link. */
export function Pair() {
  const navigate = useNavigate()
  const theme = useTheme()
  const { signInWithPairingCode } = useAuth()
  const [code] = useState(() => readPairingCodeFromHash(window.location.hash))
  const [state, setState] = useState<PairState>('redeeming')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!window.location.hash) return
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    )
  }, [])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const run = async () => {
      if (!code) {
        setState('missing')
        return
      }

      const session = await getSession()
      if (session?.data?.user) {
        showToast.info('Already signed in')
        navigate('/', { replace: true })
        return
      }

      const result = await signInWithPairingCode(code)
      if (result.error) {
        setErrorMessage(result.error)
        setState('error')
      }
    }

    void run().catch((error: unknown) => {
      setErrorMessage(error instanceof Error && error.message ? error.message : 'Sign-in failed')
      setState('error')
    })
  }, [code, navigate, signInWithPairingCode])

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-background via-background to-background p-4">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center space-y-6">
        <div className="flex flex-col items-center space-y-2">
          <img
            src={theme === 'light' ? '/opencode-wordmark-light.svg' : '/opencode-wordmark-dark.svg'}
            alt="OpenCode Manager"
            className="h-8 w-auto"
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          {state === 'redeeming' && (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm text-muted-foreground">Signing you in…</p>
            </div>
          )}

          {state === 'missing' && (
            <>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>No pairing code was found</AlertDescription>
              </Alert>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">Sign in</Link>
              </Button>
            </>
          )}

          {state === 'error' && (
            <>
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">Sign in</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
