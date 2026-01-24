import { redirect } from 'react-router-dom'
import { getSession } from './auth-client'

export interface AuthConfig {
  enabledProviders: string[]
  registrationEnabled: boolean
  isFirstUser: boolean
  adminConfigured: boolean
}

async function fetchAuthConfig(): Promise<AuthConfig> {
  const response = await fetch('/api/auth-info/config')
  if (!response.ok) {
    return {
      enabledProviders: ['credentials'],
      registrationEnabled: true,
      isFirstUser: false,
      adminConfigured: false,
    }
  }
  return response.json()
}

export async function loginLoader() {
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

export async function protectedLoader() {
  const session = await getSession()

  if (!session.data?.user) {
    return redirect('/login')
  }

  return null
}
