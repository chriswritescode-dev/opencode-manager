import { createContext } from 'react'

interface AuthState {
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  needsSetup: boolean
}

export interface AuthContextValue extends AuthState {
  login: (token: string) => Promise<boolean>
  logout: () => void
  verifyToken: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
