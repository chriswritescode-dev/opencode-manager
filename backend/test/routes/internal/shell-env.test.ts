import { describe, it, expect, beforeEach, vi } from 'vitest'

const getGhCliEnvMock = vi.hoisted(() => vi.fn())
const getDevServerPortMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/services/credential-provider', () => ({
  CredentialProvider: vi.fn().mockImplementation(() => ({ getGhCliEnv: getGhCliEnvMock })),
}))

vi.mock('../../../src/services/dev-server/manager', () => ({
  getDevServerPort: getDevServerPortMock,
}))

import { createInternalShellEnvRoutes } from '../../../src/routes/internal/shell-env'

describe('internal shell-env routes', () => {
  const mockDb = {} as never

  beforeEach(() => {
    vi.clearAllMocks()
    getGhCliEnvMock.mockReturnValue({ GH_TOKEN: 'ghp', GITHUB_TOKEN: 'ghp' })
    getDevServerPortMock.mockReturnValue(4321)
  })

  it('GET / merges gh env with the dev server port and forwards cwd', async () => {
    const app = createInternalShellEnvRoutes(mockDb)

    const res = await app.request('/?cwd=%2Frepo')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      GH_TOKEN: 'ghp',
      GITHUB_TOKEN: 'ghp',
      OCM_DEV_SERVER_PORT: '4321',
    })
    expect(getGhCliEnvMock).toHaveBeenCalledWith({ cwd: '/repo' })
  })

  it('GET / returns only the dev server port when no GitHub credential exists', async () => {
    getGhCliEnvMock.mockReturnValue({})
    const app = createInternalShellEnvRoutes(mockDb)

    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ OCM_DEV_SERVER_PORT: '4321' })
  })
})
