import { useState } from 'react'
import { Edit2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, User, KeyRound, LogOut, Plus, Trash2, AlertCircle, CheckCircle, Lock } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { passkey, changePassword } from '@/lib/auth-client'

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
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)

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

  const changePasswordMutation = useMutation({
    mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
      const response = await changePassword({ currentPassword, newPassword })
      if (response.error) {
        throw new Error(response.error.message || 'Failed to change password')
      }
      return response.data
    },
    onSuccess: () => {
      setSuccess('Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setShowChangePassword(false)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to change password')
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

  const handleChangePassword = () => {
    setError(null)
    setSuccess(null)
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    changePasswordMutation.mutate({ currentPassword, newPassword })
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card className="border-0 shadow-none">
          <CardHeader className="pb-3 sm:pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 sm:h-5 sm:w-5" />
                <CardTitle className="text-base sm:text-lg">Profile</CardTitle>
              </div>
              {!editingProfile && (
                <Button variant="ghost" size="sm" onClick={() => setEditingProfile(true)} className="h-8">
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {editingProfile ? (
              <div className="space-y-3 sm:space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs sm:text-sm">Name</Label>
                  <Input value={user.name} disabled className="h-9 sm:h-10 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs sm:text-sm">Email</Label>
                  <Input value={user.email} disabled className="h-9 sm:h-10 text-sm" />
                </div>
                <Button variant="outline" onClick={() => setEditingProfile(false)} className="h-9 sm:h-10">
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                  <span className="text-xs sm:text-sm text-muted-foreground sm:w-20">Name</span>
                  <span className="text-sm font-medium truncate">{user.name}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                  <span className="text-xs sm:text-sm text-muted-foreground sm:w-20">Email</span>
                  <span className="text-sm truncate">{user.email}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-none">
          <CardHeader className="pb-2 sm:pb-4">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Lock className="h-4 w-4 sm:h-5 sm:w-5" />
              Change Password
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">Update your account password</CardDescription>
          </CardHeader>
          <CardContent>
            {!showChangePassword ? (
              <Button
                variant="outline"
                onClick={() => setShowChangePassword(true)}
                className="h-9 sm:h-10"
              >
                <Lock className="mr-2 h-4 w-4" />
                Change Password
              </Button>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="current-password" className="text-xs sm:text-sm">Current Password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="h-9 sm:h-10 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password" className="text-xs sm:text-sm">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="h-9 sm:h-10 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleChangePassword}
                    disabled={changePasswordMutation.isPending || !currentPassword || !newPassword}
                    className="h-9 sm:h-10"
                  >
                    {changePasswordMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Lock className="mr-2 h-4 w-4" />
                    )}
                    Change Password
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowChangePassword(false)}
                    className="h-9 sm:h-10"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-none">
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

      <Card className="border-0 shadow-none">
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
