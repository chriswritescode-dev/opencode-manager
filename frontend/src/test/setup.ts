import '@testing-library/jest-dom/vitest'
import './testStorage'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { keepMount } from 'nanostores'
import { restoreBrowserFakes } from './browserFakes'
import { installFetchProxy, setActiveFetch } from './fetchProxy'
import { resetTestStores } from './resetStores'

installFetchProxy()

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

async function keepAuthSessionMounted(): Promise<void> {
  const { authClient } = await import('@/lib/auth-client')
  const session = authClient.$store.atoms.session
  if ('active' in session && session.active) keepMount(session)
}

afterEach(async () => {
  cleanup()
  restoreBrowserFakes()
  vi.unstubAllGlobals()
  setActiveFetch(null)
  resetTestStores()
  window.localStorage.clear()
  await keepAuthSessionMounted()
})
