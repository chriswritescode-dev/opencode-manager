/* eslint-disable react-refresh/only-export-components */
import { createContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { useSession, signIn, signUp, signOut, authClient, type AuthUser } from '@/lib/auth-client'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'

interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

interface AuthContextValue {
  user: AuthUser | null
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
  const { data: session, isPending, refetch } = useSession()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

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
    const from = (location.state as { from?: string })?.from || '/'
    navigate(from, { replace: true })
    return {}
  }, [refetch, navigate, location])

  const signInWithProvider = useCallback(async (provider: 'github' | 'google' | 'discord') => {
    try {
      await signIn.social({ provider, callbackURL: '/' })
      return {}
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'OAuth sign in failed' }
    }
  }, [])

  const signInWithPasskey = useCallback(async () => {
    try {
      const result = await authClient.signIn.passkey()
      if (result.error) {
        return { error: result.error.message || 'Passkey sign in failed' }
      }
      await refetch()
      const from = (location.state as { from?: string })?.from || '/'
      navigate(from, { replace: true })
      return {}
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Passkey sign in failed' }
    }
  }, [refetch, navigate, location])

  const signUpWithEmail = useCallback(async (email: string, password: string, name: string) => {
    const result = await signUp.email({ email, password, name })
    if (result.error) {
      return { error: result.error.message || 'Sign up failed' }
    }
    await refetch()
    navigate('/', { replace: true })
    return {}
  }, [refetch, navigate])

  const addPasskey = useCallback(async (name?: string) => {
    const result = await authClient.passkey.addPasskey({ name })
    if (result.error) {
      return { error: result.error.message || 'Failed to add passkey' }
    }
    return {}
  }, [])

  const logout = useCallback(async () => {
    useSettingsDialog.getState().close()
    await signOut()
    await refetch()
    navigate('/login', { replace: true })
  }, [refetch, navigate])

  const refreshSession = useCallback(async () => {
    await refetch()
  }, [refetch])

  const value: AuthContextValue = {
    user: session?.user ?? null,
    isAuthenticated: !!session?.user,
    isLoading: isPending,
    config,
    signInWithEmail,
    signInWithProvider,
    signInWithPasskey,
    signUpWithEmail,
    addPasskey,
    logout,
    refreshSession,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
