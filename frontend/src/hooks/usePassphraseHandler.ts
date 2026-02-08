import { useState, useEffect, useCallback } from 'react'

interface PassphraseRequest {
  type: 'passphrase-request'
  credentialName: string
  host: string
}

interface UsePassphraseHandlerProps {
  enabled?: boolean
  onSubmit?: (passphrase: string) => void
}

export function usePassphraseHandler({ enabled = true, onSubmit }: UsePassphraseHandlerProps = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const [credentialName, setCredentialName] = useState<string>('SSH key')
  const [host, setHost] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return

    const handlePassphraseRequest = (event: MessageEvent) => {
      const data = event.data as PassphraseRequest
      if (data.type === 'passphrase-request') {
        setCredentialName(data.credentialName)
        setHost(data.host)
        setIsOpen(true)
        setError(null)
      }
    }

    window.addEventListener('message', handlePassphraseRequest)

    return () => {
      window.removeEventListener('message', handlePassphraseRequest)
    }
  }, [enabled])

  const handleSubmitPassphrase = useCallback((passphrase: string) => {
    try {
      onSubmit?.(passphrase)
      setIsOpen(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit passphrase')
    }
  }, [onSubmit])

  const sendPassphraseResponse = useCallback((passphrase: string) => {
    window.postMessage({
      type: 'passphrase-response',
      passphrase
    }, '*')
  }, [])

  const handleSubmit = useCallback((passphrase: string) => {
    sendPassphraseResponse(passphrase)
    handleSubmitPassphrase(passphrase)
  }, [sendPassphraseResponse, handleSubmitPassphrase])

  return {
    isOpen,
    credentialName,
    host,
    error,
    onSubmit: handleSubmit,
    onOpenChange: setIsOpen
  }
}
