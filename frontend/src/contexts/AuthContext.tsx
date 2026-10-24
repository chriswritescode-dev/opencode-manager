/* eslint-disable react-refresh/only-export-components */
import { createContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import { describeUserAgent } from '@opencode-manager/shared/utils'
import { useSession, signIn, signUp, signOut, authClient } from '@/lib/auth-client'
import { redeemDevicePairingCode } from '@/api/devicePairing'
import { FetchError } from '@/api/fetchWrapper'
import { useNavigate, useLocation } from 'react-router-dom'
import { getLoginRedirectTarget } from '@/lib/auth-loaders'
import {
  STORED_AUTH_USER_KEY,
  clearStoredAuthUser,
  readStoredAuthUser,
  reconcileStoredAuthUser,
  type StoredAuthUser,
} from '@/lib/authSession'

const RATE_LIMITED_MESSAGE = 'Too many attempts. Wait a minute and try again.'
const SIGN_IN_FAILED_MESSAGE = 'Sign-in failed'

interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

interface AuthContextValue {
  user: StoredAuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  config: AuthConfig | null
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>
  signInWithProvider: (provider: 'github' | 'google' | 'discord') => Promise<{ error?: string }>
  signInWithPasskey: () => Promise<{ error?: string }>
  signInWithPairingCode: (code: string) => Promise<{ error?: string }>
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
  const [signedOut, setSignedOut] = useState(false)
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTarget = useMemo(
    () => getLoginRedirectTarget(location.search),
    [location.search],
  )

  useEffect(() => {
    if (isPending) return
    const reconciledUser = reconcileStoredAuthUser(session?.user ?? null, sessionError)
    setStoredUser(reconciledUser)
    if (reconciledUser !== null) setSignedOut(false)
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

  const signInWithPairingCode = useCallback(async (code: string) => {
    try {
      await redeemDevicePairingCode({
        code,
        deviceName: describeUserAgent(navigator.userAgent),
      })
      await refetch()
    } catch (err) {
      if (err instanceof FetchError && err.statusCode === 429) {
        return { error: RATE_LIMITED_MESSAGE }
      }
      return { error: err instanceof Error && err.message ? err.message : SIGN_IN_FAILED_MESSAGE }
    }
    navigate(redirectTarget, { replace: true })
    return {}
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
    setSignedOut(true)
    setStoredUser(null)
    clearStoredAuthUser()
    try {
      await signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = '/login'
          },
        },
      })
    } catch {
      return
    }
  }, [])

  const refreshSession = useCallback(async () => {
    await refetch()
  }, [refetch])

  const user = signedOut ? null : session?.user ?? storedUser

  useEffect(() => {
    if (user === null) return

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORED_AUTH_USER_KEY) return
      const nextUser = readStoredAuthUser()
      if (nextUser !== null && nextUser.id === user.id) return
      void logout()
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [user, logout])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: !!user,
    isLoading: isPending && !user,
    config,
    signInWithEmail,
    signInWithProvider,
    signInWithPasskey,
    signInWithPairingCode,
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
    signInWithPairingCode,
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
