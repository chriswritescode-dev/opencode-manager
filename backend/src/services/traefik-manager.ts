import type { Session } from '@opencode-manager/shared'
import { mkdir, writeFile, chmod } from 'fs/promises'
import path from 'path'
import { execCommand } from '../utils/process'
import { logger } from '../utils/logger'
import { getConfigPath } from '@opencode-manager/shared/config/env'

const TRAEFIK_CONTAINER = 'opencode-traefik'
const TRAEFIK_IMAGE = 'traefik:v2.10'
const NETWORK_NAME = 'opencode-net'

export class TraefikManager {
  private configDir = path.join(getConfigPath(), 'traefik')
  private dynamicDir = path.join(this.configDir, 'dynamic')
  private configPath = path.join(this.configDir, 'traefik.yml')
  private acmePath = path.join(this.configDir, 'acme.json')
  private dynamicSessionsPath = path.join(this.dynamicDir, 'sessions.yml')

  async ensureTraefik(): Promise<void> {
    await this.ensureConfigFiles()
    await this.ensureNetwork()
    await this.ensureContainer()
  }

  async syncRoutes(sessions: Session[]): Promise<void> {
    await this.ensureConfigFiles()
    const publicDomain = process.env.PUBLIC_DOMAIN || 'localhost'
    const enableTls = process.env.TRAEFIK_ENABLE_TLS === 'true' || publicDomain !== 'localhost'

    const runningSessions = sessions.filter((session) => session.status === 'running')
    const publicSessions = runningSessions.filter((session) => session.publicOpencodeUrl)

    const routers: string[] = []
    const services: string[] = []

    for (const session of runningSessions) {
      const localOpencodeHost = `${session.name}-opencode.localhost`
      const localCodeHost = `${session.name}-code.localhost`

      routers.push(this.buildRouter(`${session.name}-opencode-local`, localOpencodeHost, false))
      routers.push(this.buildRouter(`${session.name}-code-local`, localCodeHost, false))

      services.push(this.buildService(`${session.name}-opencode-local`, `http://${session.name}-opencode:5551`))
      services.push(this.buildService(`${session.name}-code-local`, `http://${session.name}-code:8080`))
    }

    for (const session of publicSessions) {
      const opencodeHost = `${session.name}.${publicDomain}`
      const codeHost = `${session.name}-code.${publicDomain}`

      routers.push(this.buildRouter(`${session.name}-opencode`, opencodeHost, enableTls))
      routers.push(this.buildRouter(`${session.name}-code`, codeHost, enableTls))

      services.push(this.buildService(`${session.name}-opencode`, `http://${session.name}-opencode:5551`))
      services.push(this.buildService(`${session.name}-code`, `http://${session.name}-code:8080`))
    }

    const dynamicConfig = [
      'http:',
      '  routers:',
      routers.length > 0 ? routers.join('\n') : '    {}',
      '  services:',
      services.length > 0 ? services.join('\n') : '    {}',
      '',
    ].join('\n')

    await writeFile(this.dynamicSessionsPath, dynamicConfig, 'utf-8')
  }

  private buildRouter(name: string, host: string, enableTls: boolean): string {
    const lines = [
      `    ${name}:`,
      `      rule: Host(\`${host}\`)`,
      '      entryPoints:',
      enableTls ? '        - websecure' : '        - web',
      `      service: ${name}`,
    ]

    if (enableTls) {
      lines.push('      tls:', '        certResolver: letsencrypt')
    }

    return lines.join('\n')
  }

  private buildService(name: string, url: string): string {
    return [
      `    ${name}:`,
      '      loadBalancer:',
      '        servers:',
      `          - url: ${url}`,
    ].join('\n')
  }

  private async ensureConfigFiles(): Promise<void> {
    await mkdir(this.dynamicDir, { recursive: true })

    const publicDomain = process.env.PUBLIC_DOMAIN || 'localhost'
    const enableTls = process.env.TRAEFIK_ENABLE_TLS === 'true' || publicDomain !== 'localhost'
    const email = process.env.TRAEFIK_ACME_EMAIL || `admin@${publicDomain}`

    const baseConfig = [
      'entryPoints:',
      '  web:',
      '    address: ":80"',
      '  websecure:',
      '    address: ":443"',
      'providers:',
      '  file:',
      '    directory: /etc/traefik/dynamic',
      '    watch: true',
      enableTls ? 'certificatesResolvers:' : null,
      enableTls ? '  letsencrypt:' : null,
      enableTls ? '    acme:' : null,
      enableTls ? `      email: ${email}` : null,
      enableTls ? '      storage: /acme.json' : null,
      enableTls ? '      httpChallenge:' : null,
      enableTls ? '        entryPoint: web' : null,
    ].filter(Boolean).join('\n')

    await writeFile(this.configPath, baseConfig, 'utf-8')
    await writeFile(this.dynamicSessionsPath, 'http:\n  routers: {}\n  services: {}\n', 'utf-8')

    await writeFile(this.acmePath, '{}', 'utf-8')
    await chmod(this.acmePath, 0o600)
  }

  private async ensureNetwork(): Promise<void> {
    const result = await execCommand(
      ['docker', 'network', 'ls', '--filter', `name=${NETWORK_NAME}`, '--format', '{{.Name}}'],
      { ignoreExitCode: true, silent: true }
    ) as { exitCode: number; stdout: string }

    if (result.exitCode === 0 && result.stdout.trim().split('\n').includes(NETWORK_NAME)) {
      return
    }

    await execCommand(['docker', 'network', 'create', NETWORK_NAME])
  }

  private async ensureContainer(): Promise<void> {
    const existing = await execCommand(
      ['docker', 'ps', '-a', '--filter', `name=${TRAEFIK_CONTAINER}`, '--format', '{{.Names}}'],
      { ignoreExitCode: true, silent: true }
    ) as { exitCode: number; stdout: string }

    const names = existing.stdout.trim().split('\n').filter(Boolean)
    if (names.includes(TRAEFIK_CONTAINER)) {
      const running = await execCommand(
        ['docker', 'ps', '--filter', `name=${TRAEFIK_CONTAINER}`, '--format', '{{.Names}}'],
        { ignoreExitCode: true, silent: true }
      ) as { exitCode: number; stdout: string }
      if (running.stdout.trim().split('\n').includes(TRAEFIK_CONTAINER)) {
        return
      }
      await execCommand(['docker', 'start', TRAEFIK_CONTAINER])
      return
    }

    logger.info('Starting Traefik reverse proxy')
    await execCommand([
      'docker', 'run', '-d',
      '--name', TRAEFIK_CONTAINER,
      '--restart', 'unless-stopped',
      '--network', NETWORK_NAME,
      '-p', '80:80',
      '-p', '443:443',
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '-v', `${this.configPath}:/etc/traefik/traefik.yml`,
      '-v', `${this.dynamicDir}:/etc/traefik/dynamic`,
      '-v', `${this.acmePath}:/acme.json`,
      TRAEFIK_IMAGE,
    ])
  }
}
