import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, API_BASE_URL } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Key, 
  Plus, 
  Trash2, 
  Copy, 
  Check, 
  AlertCircle,
  LogOut,
  Loader2 
} from 'lucide-react'
import { showToast } from '@/lib/toast'

interface ApiToken {
  id: number
  comment: string | null
  createdAt: number
  lastUsedAt: number | null
  isActive: boolean
}

interface CreateTokenResponse {
  id: number
  token: string
  comment: string | null
  createdAt: number
}

export function TokenSettings() {
  const { logout } = useAuth()
  const queryClient = useQueryClient()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showNewTokenDialog, setShowNewTokenDialog] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [tokenComment, setTokenComment] = useState('')
  const [copied, setCopied] = useState(false)
  const [deleteTokenId, setDeleteTokenId] = useState<number | null>(null)

  const { data: tokens, isLoading } = useQuery({
    queryKey: ['auth', 'tokens'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiToken[]>(`${API_BASE_URL}/api/auth/tokens`)
      return data
    },
  })

  const createTokenMutation = useMutation({
    mutationFn: async (comment?: string) => {
      const { data } = await apiClient.post<CreateTokenResponse>(
        `${API_BASE_URL}/api/auth/tokens`,
        { comment }
      )
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'tokens'] })
      setNewToken(data.token)
      setShowCreateDialog(false)
      setShowNewTokenDialog(true)
      setTokenComment('')
    },
    onError: () => {
      showToast.error('Failed to create token')
    },
  })

  const deleteTokenMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`${API_BASE_URL}/api/auth/tokens/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'tokens'] })
      showToast.success('Token deleted')
      setDeleteTokenId(null)
    },
    onError: () => {
      showToast.error('Failed to delete token')
    },
  })

  const handleCopy = async () => {
    if (newToken) {
      await navigator.clipboard.writeText(newToken)
      setCopied(true)
      showToast.success('Token copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const activeTokens = tokens?.filter(t => t.isActive) || []

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API Tokens
              </CardTitle>
              <CardDescription>
                Manage access tokens for the OpenCode Manager API
              </CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Token
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeTokens.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No active tokens. Create one to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {activeTokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between p-4 bg-accent/50 rounded-lg border border-border"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {token.comment || 'Unnamed token'}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-500 rounded">
                        Active
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Created: {formatDate(token.createdAt)}
                      {token.lastUsedAt && (
                        <span className="ml-4">
                          Last used: {formatDate(token.lastUsedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteTokenId(token.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <LogOut className="h-5 w-5" />
            Sign Out
          </CardTitle>
          <CardDescription>
            Sign out from this device. You'll need your token to sign back in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={logout}>
            Sign Out
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Token</DialogTitle>
            <DialogDescription>
              Add an optional description to help identify this token later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder="e.g., Laptop, CI/CD, Mobile..."
              value={tokenComment}
              onChange={(e) => setTokenComment(e.target.value)}
              className="bg-background"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => createTokenMutation.mutate(tokenComment || undefined)}
              disabled={createTokenMutation.isPending}
            >
              {createTokenMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Token'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewTokenDialog} onOpenChange={setShowNewTokenDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Token Created Successfully</DialogTitle>
            <DialogDescription>
              Copy this token now. You won't be able to see it again!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Alert className="bg-amber-500/10 border-amber-500/50">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-amber-200">
                This token will only be shown once. Make sure to copy and store it securely.
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Input
                value={newToken || ''}
                readOnly
                className="font-mono text-sm bg-background"
              />
              <Button onClick={handleCopy} variant="outline" size="icon">
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button 
              onClick={() => {
                setShowNewTokenDialog(false)
                setNewToken(null)
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTokenId !== null} onOpenChange={() => setDeleteTokenId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Token</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this token? Any applications using it will lose access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTokenId(null)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => deleteTokenId && deleteTokenMutation.mutate(deleteTokenId)}
              disabled={deleteTokenMutation.isPending}
            >
              {deleteTokenMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Token'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
