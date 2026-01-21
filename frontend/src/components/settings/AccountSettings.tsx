import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, User, KeyRound, LogOut, Plus, Trash2, AlertCircle, CheckCircle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { passkey } from '@/lib/auth-client'

interface Passkey {
  id: string
  name?: string
  credentialID: string
  createdAt: string
  deviceType: string
}

export function AccountSettings() {
  const { user, addPasskey, logout } = useAuth()
  const queryClient = useQueryClient()
  const [passkeyName, setPasskeyName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const { data: passkeys, isLoading: passkeysLoading } = useQuery({
    queryKey: ['passkeys'],
    queryFn: async () => {
      const response = await fetch('/api/auth/passkey/list-user-passkeys', {
        credentials: 'include',
      })
      if (!response.ok) return []
      return response.json() as Promise<Passkey[]>
    },
    enabled: !!user,
  })

  const addPasskeyMutation = useMutation({
    mutationFn: async (name: string) => {
      return addPasskey(name || undefined)
    },
    onSuccess: (result) => {
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess('Passkey added successfully')
        setPasskeyName('')
        queryClient.invalidateQueries({ queryKey: ['passkeys'] })
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to add passkey')
    },
  })

  const deletePasskeyMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await passkey.deletePasskey({ id })
      if (response.error) {
        throw new Error(response.error.message || 'Failed to delete passkey')
      }
      return response.data
    },
    onSuccess: () => {
      setSuccess('Passkey deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['passkeys'] })
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to delete passkey')
    },
  })

  const handleAddPasskey = async () => {
    setError(null)
    setSuccess(null)
    addPasskeyMutation.mutate(passkeyName)
  }

  const handleDeletePasskey = (id: string) => {
    setError(null)
    setSuccess(null)
    if (confirm('Are you sure you want to delete this passkey?')) {
      deletePasskeyMutation.mutate(id)
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-500 text-green-700 dark:text-green-400">
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <Card className="border-0 sm:border shadow-none sm:shadow-sm">
        <CardHeader className="pb-2 sm:pb-4">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <User className="h-4 w-4 sm:h-5 sm:w-5" />
            Profile
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs sm:text-sm">Name</Label>
            <Input value={user.name} disabled className="h-9 sm:h-10 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs sm:text-sm">Email</Label>
            <Input value={user.email} disabled className="h-9 sm:h-10 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs sm:text-sm">Role</Label>
            <Input value={(user as { role?: string }).role || 'user'} disabled className="h-9 sm:h-10 text-sm" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 sm:border shadow-none sm:shadow-sm">
        <CardHeader className="pb-2 sm:pb-4">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <KeyRound className="h-4 w-4 sm:h-5 sm:w-5" />
            Passkeys
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Manage passkeys for passwordless sign-in</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Passkey name (optional)"
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              className="h-9 sm:h-10 text-sm"
            />
            <Button 
              onClick={handleAddPasskey} 
              disabled={addPasskeyMutation.isPending}
              className="h-9 sm:h-10 whitespace-nowrap"
            >
              {addPasskeyMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add Passkey
            </Button>
          </div>

          {passkeysLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : passkeys && passkeys.length > 0 ? (
            <div className="space-y-2">
              {passkeys.map((pk) => (
                <div
                  key={pk.id}
                  className="flex items-center justify-between p-2.5 sm:p-3 bg-muted rounded-lg"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{pk.name || 'Unnamed Passkey'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {pk.deviceType} - {new Date(pk.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 ml-2 flex-shrink-0"
                    onClick={() => handleDeletePasskey(pk.id)}
                    disabled={deletePasskeyMutation.isPending}
                  >
                    {deletePasskeyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs sm:text-sm text-muted-foreground text-center py-3">
              No passkeys registered. Add one for passwordless sign-in.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 sm:border shadow-none sm:shadow-sm">
        <CardHeader className="pb-2 sm:pb-4">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg text-destructive">
            <LogOut className="h-4 w-4 sm:h-5 sm:w-5" />
            Sign Out
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Sign out of your account</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={logout} className="h-9 sm:h-10">
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
