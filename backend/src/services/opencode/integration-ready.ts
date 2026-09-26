import { isIntegrationNotFoundError, type OpenCodeApi } from '@opencode-manager/shared/opencode'

export const INTEGRATION_READY_POLL_INTERVAL_MS = 100
export const INTEGRATION_READY_TIMEOUT_MS = 2000

export type IntegrationTarget = Parameters<OpenCodeApi['integration']['get']>[0]

type IntegrationReader = Pick<OpenCodeApi, 'integration'>

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function isIntegrationAvailable(api: IntegrationReader, target: IntegrationTarget): Promise<boolean | undefined> {
  try {
    await api.integration.get(target)
    return true
  } catch (error) {
    return isIntegrationNotFoundError(error) ? false : undefined
  }
}

async function waitForIntegration(api: IntegrationReader, target: IntegrationTarget): Promise<boolean> {
  const deadline = Date.now() + INTEGRATION_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    await delay(INTEGRATION_READY_POLL_INTERVAL_MS)
    const available = await isIntegrationAvailable(api, target)
    if (available !== false) return available === true
  }
  return false
}

export async function runWhenIntegrationReady<T>(
  api: IntegrationReader,
  target: IntegrationTarget,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (!isIntegrationNotFoundError(error)) throw error
    if (!(await waitForIntegration(api, target))) throw error
    return await action()
  }
}
