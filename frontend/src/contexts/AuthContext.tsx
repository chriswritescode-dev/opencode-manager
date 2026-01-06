import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { API_BASE_URL } from '@/config'
import { getStoredToken, setStoredToken, removeStoredToken } from '@/lib/auth'
import { AuthContext } from './auth-context'

export { AuthContext, type AuthContextValue } from './auth-context'

interface AuthState {
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  needsSetup: boolean
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: getStoredToken(),
    isAuthenticated: false,
    isLoading: true,
    needsSetup: false,
  })

  const verifyToken = useCallback(async () => {
    const storedToken = getStoredToken()
    
    try {
      const headers: Record<string, string> = {}
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`
      }
      
      const response = await fetch(`${API_BASE_URL}/api/auth/verify`, { headers })
      const data = await response.json()
      
      if (data.valid) {
        setState({
          token: storedToken,
          isAuthenticated: true,
          isLoading: false,
          needsSetup: false,
        })
      } else {
        removeStoredToken()
        setState({
          token: null,
          isAuthenticated: false,
          isLoading: false,
          needsSetup: data.needsSetup || false,
        })
      }
    } catch {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isAuthenticated: false,
      }))
    }
  }, [])

  useEffect(() => {
    verifyToken()
  }, [verifyToken])

  const login = useCallback(async (token: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      const data = await response.json()
      
      if (data.valid) {
        setStoredToken(token)
        setState({
          token,
          isAuthenticated: true,
          isLoading: false,
          needsSetup: false,
        })
        return true
      }
      return false
    } catch {
      return false
    }
  }, [])

  const logout = useCallback(() => {
    removeStoredToken()
    setState({
      token: null,
      isAuthenticated: false,
      isLoading: false,
      needsSetup: false,
    })
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, login, logout, verifyToken }}>
      {children}
    </AuthContext.Provider>
  )
}
