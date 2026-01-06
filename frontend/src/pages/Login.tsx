import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { KeyRound, AlertCircle, Loader2 } from 'lucide-react'

export function Login() {
  const { login, needsSetup } = useAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    const trimmedToken = token.trim()
    
    if (!trimmedToken) {
      setError('Please enter a token')
      setIsLoading(false)
      return
    }

    if (!trimmedToken.startsWith('ocm_')) {
      setError('Invalid token format. Token should start with "ocm_"')
      setIsLoading(false)
      return
    }

    const success = await login(trimmedToken)
    
    if (!success) {
      setError('Invalid or expired token')
    }
    
    setIsLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#0d0d0d] to-[#0a0a0a] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-[#141414] border-[#262626]">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-blue-600/10 flex items-center justify-center">
            <KeyRound className="h-6 w-6 text-blue-500" />
          </div>
          <CardTitle className="text-xl text-white">OpenCode Manager</CardTitle>
          <CardDescription className="text-zinc-400">
            {needsSetup 
              ? 'Enter the API token shown in your server console'
              : 'Enter your API token to continue'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive" className="bg-red-900/20 border-red-900/50">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            {needsSetup && (
              <Alert className="bg-blue-900/20 border-blue-900/50">
                <AlertDescription className="text-blue-200 text-sm">
                  This appears to be a fresh installation. Your token was saved to:<br />
                  <code className="text-xs bg-black/30 px-1 py-0.5 rounded mt-1 inline-block">
                    ~/.config/opencode-manager.json
                  </code>
                </AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="ocm_xxxxxxxxxxxxxxxx..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="bg-[#1a1a1a] border-[#333] text-white placeholder:text-zinc-600 font-mono"
                autoFocus
                autoComplete="off"
              />
            </div>
            
            <Button 
              type="submit" 
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
          
          <div className="mt-6 text-center">
            <p className="text-xs text-zinc-500">
              Tokens can be managed in Settings after signing in
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
