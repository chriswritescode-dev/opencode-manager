/* eslint-disable react-refresh/only-export-components */
import { createContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession, signIn, signUp, signOut, authClient, type AuthUser } from '@/lib/auth-client'
import { useNavigate, useLocation } from 'react-router-dom'
import { getLoginRedirectTarget } from '@/lib/auth-loaders'
import {
  clearStoredAuthUser,
  isTransientSessionError,
  readStoredAuthUser,
  toStoredAuthUser,
  writeStoredAuthUser,
  type StoredAuthUser,
} from '@/lib/authSession'
import { clearPersistedQueryCache } from '@/lib/queryPersistence'

interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

export type AuthContextUser = Pick<AuthUser, 'id' | 'email' | 'name'>

interface AuthContextValue {
  user: AuthContextUser | null
  isAuthenticated: boolean
  isLoading: boolean
  config: AuthConfig | null
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>
  signInWithProvider: (provider: 'github' | 'google' | 'discord') => Promise<{ error?: string }>
  signInWithPasskey: () => Promise<{ error?: string }>
  signUpWithEmail: (email: string, password: string, name: string) => Promise<{ error?: string }>
  addPasskey: (name?: string) => Promise<{ error?: string }>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export { useAuth } from '@/hooks/useAuth'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { data: session, error: sessionError, isPending, refetch } = useSession()
  const [storedUser, setStoredUser] = useState<StoredAuthUser | null>(() => readStoredAuthUser())
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTarget = useMemo(
    () => getLoginRedirectTarget(location.search),
    [location.search],
  )

  useEffect(() => {
    if (session?.user) {
      const validatedUser = toStoredAuthUser(session.user)
      writeStoredAuthUser(validatedUser)
      setStoredUser(validatedUser)
      return
    }
    if (isPending) return
    if (isTransientSessionError(sessionError)) return
    clearStoredAuthUser()
    setStoredUser(null)
  }, [session, sessionError, isPending])

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/auth-info/config')
        if (response.ok) {
          const data = await response.json()
          setConfig(data)
        }
      } catch {
        setConfig({
          enabledProviders: ['credentials'],
          registrationEnabled: true,
          isFirstUser: true,
          adminConfigured: false,
        })
      }
    }
    fetchConfig()
  }, [])

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const result = await signIn.email({ email, password })
    if (result.error) {
      return { error: result.error.message || 'Sign in failed' }
    }
    await refetch()
    navigate(redirectTarget, { replace: true })
    return {}
  }, [refetch, navigate, redirectTarget])

  const signInWithProvider = useCallback(async (provider: 'github' | 'google' | 'discord') => {
    try {
      await signIn.social({ provider, callbackURL: redirectTarget })
      return {}
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'OAuth sign in failed' }
    }
  }, [redirectTarget])

  const signInWithPasskey = useCallback(async () => {
    try {
      const result = await authClient.signIn.passkey()
      if (result.error) {
        return { error: result.error.message || 'Passkey sign in failed' }
      }
      await refetch()
      navigate(redirectTarget, { replace: true })
      return {}
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Passkey sign in failed' }
    }
  }, [refetch, navigate, redirectTarget])

  const signUpWithEmail = useCallback(async (email: string, password: string, name: string) => {
    const result = await signUp.email({ email, password, name })
    if (result.error) {
      return { error: result.error.message || 'Sign up failed' }
    }
    await refetch()
    navigate(redirectTarget, { replace: true })
    return {}
  }, [refetch, navigate, redirectTarget])

  const addPasskey = useCallback(async (name?: string) => {
    const result = await authClient.passkey.addPasskey({ name })
    if (result.error) {
      return { error: result.error.message || 'Failed to add passkey' }
    }
    return {}
  }, [])

  const logout = useCallback(async () => {
    clearStoredAuthUser()
    setStoredUser(null)
    clearPersistedQueryCache()
    queryClient.clear()
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = '/login'
        },
      },
    })
  }, [queryClient])

  const refreshSession = useCallback(async () => {
    await refetch()
  }, [refetch])

  const user = session?.user ?? storedUser

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: !!user,
    isLoading: isPending && !user,
    config,
    signInWithEmail,
    signInWithProvider,
    signInWithPasskey,
    signUpWithEmail,
    addPasskey,
    logout,
    refreshSession,
  }), [
    user,
    isPending,
    config,
    signInWithEmail,
    signInWithProvider,
    signInWithPasskey,
    signUpWithEmail,
    addPasskey,
    logout,
    refreshSession,
  ])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
