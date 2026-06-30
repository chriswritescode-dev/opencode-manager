import { existsSync } from 'fs'

export function isRunningInDocker(
  exists: (p: string) => boolean = existsSync,
): boolean {
  return exists('/.dockerenv') || process.env.OCM_IN_DOCKER === 'true'
}

export function isDockerSocketAvailable(
  exists: (p: string) => boolean = existsSync,
): boolean {
  return !!process.env.DOCKER_HOST || exists('/var/run/docker.sock')
}
