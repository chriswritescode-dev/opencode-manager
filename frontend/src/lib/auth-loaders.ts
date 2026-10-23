import { redirect, type LoaderFunctionArgs } from 'react-router-dom'
import { getSession } from './auth-client'

export interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

const DEFAULT_REDIRECT_TARGET = '/'

/**
 * Returns `value` when it is a same-origin relative path, otherwise the app root. Protocol-relative
 * paths, absolute URLs and backslash-escaped variants are rejected so the login redirect cannot be
 * used as an open redirect.
 */
export function resolveRedirectTarget(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_REDIRECT_TARGET
  if (!value.startsWith('/') || value.startsWith('//')) return DEFAULT_REDIRECT_TARGET
  if (value.includes('\\') || value.includes(':')) return DEFAULT_REDIRECT_TARGET
  return value
}

export function getLoginRedirectTarget(search: string): string {
  return resolveRedirectTarget(new URLSearchParams(search).get('redirect'))
}

/**
 * Builds the login URL that returns the visitor to `target` after signing in. The root target omits
 * the query parameter so a plain login URL stays unchanged.
 */
export function loginRedirectPath(target: unknown): string {
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
  const session = await getSession()

  if (!session.data?.user) {
    const url = new URL(request.url)
    return redirect(loginRedirectPath(`${url.pathname}${url.search}${url.hash}`))
  }

  return null
}
