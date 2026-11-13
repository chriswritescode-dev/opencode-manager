import { redirect, type LoaderFunctionArgs } from 'react-router-dom'
import { getSession } from './auth-client'
import { reconcileStoredAuthUser } from './authSession'

export interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

const DEFAULT_REDIRECT_TARGET = '/'

export function resolveRedirectTarget(value: string | null): string {
  if (value === null) return DEFAULT_REDIRECT_TARGET
  if (!value.startsWith('/') || value.startsWith('//')) return DEFAULT_REDIRECT_TARGET
  if (value.includes('\\') || value.includes(':')) return DEFAULT_REDIRECT_TARGET
  return value
}

export function getLoginRedirectTarget(search: string): string {
  return resolveRedirectTarget(new URLSearchParams(search).get('redirect'))
}

export function loginRedirectPath(target: string | null): string {
  const resolved = resolveRedirectTarget(target)
  return resolved === DEFAULT_REDIRECT_TARGET
    ? '/login'
    : `/login?redirect=${encodeURIComponent(resolved)}`
}

async function fetchAuthConfig(): Promise<AuthConfig> {
  const defaultConfig: AuthConfig = {
    enabledProviders: ['credentials'],
    registrationEnabled: true,
    isFirstUser: false,
    adminConfigured: false,
  }
  const response = await fetch('/api/auth-info/config')
  if (!response.ok) {
    return defaultConfig
  }
  try {
    return await response.json()
  } catch {
    return defaultConfig
  }
}

export async function loginLoader({ request }: LoaderFunctionArgs) {
  const [config, session] = await Promise.all([
    fetchAuthConfig(),
    getSession(),
  ])

  if (session.data?.user) {
    return redirect(getLoginRedirectTarget(new URL(request.url).search))
  }

  if (config.isFirstUser && !config.adminConfigured) {
    return redirect('/setup')
  }

  return { config }
}

export async function setupLoader() {
  const [config, session] = await Promise.all([
    fetchAuthConfig(),
    getSession(),
  ])

  if (session.data?.user) {
    return redirect('/')
  }

  if (!config.isFirstUser || config.adminConfigured) {
    return redirect('/login')
  }

  return { config }
}

export async function registerLoader() {
  const [config, session] = await Promise.all([
    fetchAuthConfig(),
    getSession(),
  ])

  if (session.data?.user) {
    return redirect('/')
  }

  if (!config.registrationEnabled) {
    return redirect('/login')
  }

  if (config.isFirstUser && !config.adminConfigured) {
    return redirect('/setup')
  }

  return { config }
}

export async function protectedLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  let session: Awaited<ReturnType<typeof getSession>> | null = null
  let failure: Error | null = null
  try {
    session = await getSession()
  } catch (cause) {
    failure = cause instanceof Error ? cause : new Error(String(cause))
  }

  const storedUser = reconcileStoredAuthUser(
    session?.data?.user ?? null,
    failure ?? session?.error ?? null,
  )
  if (storedUser !== null) return null

  return redirect(loginRedirectPath(`${url.pathname}${url.search}${url.hash}`))
}
