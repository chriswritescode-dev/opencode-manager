import { createAuthClient } from 'better-auth/react'
import { passkeyClient } from '@better-auth/passkey/client'

const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/auth`
  }
  return 'http://localhost:5001/api/auth'
}

export const authClient = createAuthClient({
  baseURL: getBaseUrl(),
  plugins: [passkeyClient()],
})

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  changePassword,
} = authClient

export const passkey = authClient.passkey

export type AuthSession = typeof authClient.$Infer.Session
export type AuthUser = AuthSession['user']
