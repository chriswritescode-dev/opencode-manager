import { describe, it, expect, afterEach } from 'vitest'
import { isRunningInDocker, isDockerSocketAvailable } from '../../src/utils/runtime-env'

describe('isRunningInDocker', () => {
  afterEach(() => {
    delete process.env.OCM_IN_DOCKER
  })

  it('returns true when /.dockerenv exists', () => {
    const fakeExists = (p: string) => p === '/.dockerenv'
    expect(isRunningInDocker(fakeExists)).toBe(true)
  })

  it('returns false when neither marker nor env var is set', () => {
    const fakeExists = () => false
    expect(isRunningInDocker(fakeExists)).toBe(false)
  })

  it('returns true when OCM_IN_DOCKER env is "true" even without marker', () => {
    process.env.OCM_IN_DOCKER = 'true'
    const fakeExists = () => false
    expect(isRunningInDocker(fakeExists)).toBe(true)
  })

  it('returns false when OCM_IN_DOCKER env is set to a non-"true" value', () => {
    process.env.OCM_IN_DOCKER = 'false'
    const fakeExists = () => false
    expect(isRunningInDocker(fakeExists)).toBe(false)
  })

  it('returns true when both marker and env are present', () => {
    process.env.OCM_IN_DOCKER = 'true'
    const fakeExists = (p: string) => p === '/.dockerenv'
    expect(isRunningInDocker(fakeExists)).toBe(true)
  })
})

describe('isDockerSocketAvailable', () => {
  afterEach(() => {
    delete process.env.DOCKER_HOST
  })

  it('returns true when DOCKER_HOST env is set', () => {
    process.env.DOCKER_HOST = 'tcp://127.0.0.1:2375'
    const fakeExists = () => false
    expect(isDockerSocketAvailable(fakeExists)).toBe(true)
  })

  it('returns true when /var/run/docker.sock exists', () => {
    const fakeExists = (p: string) => p === '/var/run/docker.sock'
    expect(isDockerSocketAvailable(fakeExists)).toBe(true)
  })

  it('returns false when neither socket nor DOCKER_HOST is present', () => {
    const fakeExists = () => false
    expect(isDockerSocketAvailable(fakeExists)).toBe(false)
  })

  it('prefers DOCKER_HOST over socket check', () => {
    process.env.DOCKER_HOST = 'tcp://127.0.0.1:2375'
    const fakeExists = () => false
    expect(isDockerSocketAvailable(fakeExists)).toBe(true)
  })
})
