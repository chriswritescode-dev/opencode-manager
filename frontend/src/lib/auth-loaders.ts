import { redirect } from 'react-router-dom'
import { getSession } from './auth-client'

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && (error.message === 'Failed to fetch' || error.message.includes('network'))
}

const defaultAuthConfig: AuthConfig = {
  enabledProviders: ['credentials'],
  registrationEnabled: true,
  isFirstUser: false,
  adminConfigured: false,
}

export interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
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

export async function loginLoader() {
  try {
    const [config, session] = await Promise.all([
      fetchAuthConfig(),
      getSession(),
    ])

    if (session.data?.user) {
      return redirect('/')
    }

    if (config.isFirstUser && !config.adminConfigured) {
      return redirect('/setup')
    }

    return { config }
  } catch (error) {
    if (isNetworkError(error)) return { config: defaultAuthConfig }
    throw error
  }
}

export async function setupLoader() {
  try {
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
  } catch (error) {
    if (isNetworkError(error)) return { config: defaultAuthConfig }
    throw error
  }
}

export async function registerLoader() {
  try {
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
  } catch (error) {
    if (isNetworkError(error)) return { config: defaultAuthConfig }
    throw error
  }
}

export async function protectedLoader() {
  try {
    const session = await getSession()
    if (!session.data?.user) {
      return redirect('/login')
    }
    return null
  } catch (error) {
    if (isNetworkError(error)) return null
    throw error
  }
}
