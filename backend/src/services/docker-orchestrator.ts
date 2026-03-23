import Docker from 'dockerode'
import { logger } from '../utils/logger'
import { writeFile, access } from 'fs/promises'
import path from 'path'
import os from 'os'
import { execCommand } from '../utils/process'
import { TIMEOUTS, getWorkspacePath, getContainerWorkspacePath, ENV } from '@opencode-manager/shared/config/env'

export interface ComposeConfig {
  sessionName: string
  sessionPath: string
  imageId?: string
  nixPackages: string
  configHash: string
  publicDomain: string
  devcontainerTemplate: string
}

export interface ContainerInfo {
  id: string
  name: string
  state: 'running' | 'stopped' | 'exited' | 'created'
  health?: 'healthy' | 'unhealthy' | 'starting'
  uptime?: number
}

export class DockerOrchestrator {
  private docker: Docker
  private networkName = 'opencode-net'

  constructor() {
    const socketPath = process.env.DOCKER_SOCKET || 
      (process.platform === 'darwin' 
        ? `${process.env.HOME}/.docker/run/docker.sock`
        : '/var/run/docker.sock')
    this.docker = new Docker({ socketPath })
  }

  async ensureNetwork(): Promise<void> {
    try {
      const networks = await this.docker.listNetworks({
        filters: { name: [this.networkName] }
      })

      if (networks.length === 0) {
        logger.info(`Creating Docker network: ${this.networkName}`)
        await this.docker.createNetwork({
          Name: this.networkName,
          Driver: 'bridge',
          CheckDuplicate: true,
        })
        logger.info(`Docker network created: ${this.networkName}`)
      } else {
        logger.info(`Docker network already exists: ${this.networkName}`)
      }
    } catch (error) {
      logger.error('Failed to ensure Docker network:', error)
      throw error
    }
  }

  async createSessionPod(config: ComposeConfig): Promise<void> {
    await this.ensureNetwork()
    const composeFile = await this.generateComposeFile(config)
    const composeFilePath = path.join(config.sessionPath, 'docker-compose.yml')
    
    await writeFile(composeFilePath, composeFile, 'utf-8')
    logger.info(`Wrote docker-compose.yml to ${composeFilePath}`)

    try {
      await execCommand(
        ['docker', 'compose', '-f', composeFilePath, 'up', '-d'],
        { cwd: config.sessionPath }
      )
      logger.info(`Session pod started: ${config.sessionName}`)
    } catch (error) {
      logger.error(`Failed to start session pod ${config.sessionName}:`, error)
      throw error
    }
  }

  async stopSessionPod(sessionName: string, sessionPath: string): Promise<void> {
    const composeFilePath = path.join(sessionPath, 'docker-compose.yml')
    
    try {
      await execCommand(
        ['docker', 'compose', '-f', composeFilePath, 'stop'],
        { cwd: sessionPath }
      )
      logger.info(`Session pod stopped: ${sessionName}`)
    } catch (error) {
      logger.error(`Failed to stop session pod ${sessionName}:`, error)
      throw error
    }
  }

  async destroySessionPod(sessionName: string, sessionPath: string): Promise<void> {
    const composeFilePath = path.join(sessionPath, 'docker-compose.yml')
    
    try {
      await execCommand(
        ['docker', 'compose', '-f', composeFilePath, 'down', '-v'],
        { cwd: sessionPath }
      )
      logger.info(`Session pod destroyed: ${sessionName}`)
    } catch (error) {
      logger.error(`Failed to destroy session pod ${sessionName}:`, error)
      throw error
    }
  }

  async getContainerStatus(containerName: string): Promise<ContainerInfo | null> {
    try {
      const containers = await this.docker.listContainers({ all: true })
      const container = containers.find(c => 
        c.Names.some(name => name.includes(containerName))
      )

      if (!container) {
        return null
      }

      const inspect = await this.docker.getContainer(container.Id).inspect()
      const health = inspect.State?.Health?.Status
      const startedAt = inspect.State?.StartedAt
      const uptime = startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)) : undefined

      return {
        id: container.Id,
        name: container.Names[0]?.replace(/^\//, '') || containerName,
        state: container.State as ContainerInfo['state'],
        health: health === 'healthy' ? 'healthy'
          : health === 'unhealthy' ? 'unhealthy'
          : health === 'starting' ? 'starting'
          : container.Status.includes('healthy') ? 'healthy' 
          : container.Status.includes('unhealthy') ? 'unhealthy'
          : container.Status.includes('health: starting') ? 'starting'
          : undefined,
        uptime,
      }
    } catch (error) {
      logger.error(`Failed to get container status for ${containerName}:`, error)
      return null
    }
  }

  async getContainerId(containerName: string): Promise<string | null> {
    const status = await this.getContainerStatus(containerName)
    return status?.id || null
  }

  async waitForContainersHealthy(
    containerNames: string[],
    options?: { timeoutMs?: number; intervalMs?: number }
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? TIMEOUTS.HEALTH_CHECK_TIMEOUT_MS
    const intervalMs = options?.intervalMs ?? TIMEOUTS.HEALTH_CHECK_INTERVAL_MS
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const statuses = await Promise.all(
        containerNames.map((name) => this.getContainerStatus(name))
      )

      const unhealthy = statuses.find((status) =>
        status && (status.health === 'unhealthy' || status.state === 'exited')
      )
      if (unhealthy) {
        throw new Error(`Container unhealthy: ${unhealthy.name}`)
      }

      const ready = statuses.every((status) =>
        status && status.state === 'running' && (status.health === 'healthy' || status.health === undefined)
      )
      if (ready) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new Error(`Health check timed out after ${timeoutMs}ms`)
  }

  private async generateComposeFile(config: ComposeConfig): Promise<string> {
    const workspacePath = getWorkspacePath()
    const containerWorkspacePath = getContainerWorkspacePath()
    const workspaceMount = `      - ${workspacePath}:${containerWorkspacePath}`
    const containerSessionPath = path.posix.join(
      containerWorkspacePath,
      ENV.WORKSPACE.WORKSPACES_DIR,
      config.sessionName
    )
    const skillsPath = path.join(os.homedir(), '.claude', 'skills')
    let skillsMount = ''
    try {
      await access(skillsPath)
      skillsMount = `      - ${skillsPath}:${skillsPath}:ro`
    } catch {
      skillsMount = ''
    }
    const isDarwin = process.platform === 'darwin'
    const dindVolume = isDarwin
      ? `      - ${config.sessionName}-dind-data:/var/lib/docker`
      : `      - ${config.sessionPath}/docker:/var/lib/docker`
    const dindVolumeDefinition = isDarwin
      ? `  ${config.sessionName}-dind-data:\n    name: ${config.sessionName}-dind-data\n`
      : ''
    const opencodeBlock = config.imageId
      ? `    image: ${config.imageId}`
       : `    build:
       context: ${workspacePath}/devcontainers/${config.devcontainerTemplate}
       dockerfile: Dockerfile.nix
       args:
         NIX_PACKAGES: ${config.nixPackages}
         DEVCONTAINER_HASH: ${config.configHash}`

    return `version: '3.8'

services:
  dind:
    image: docker:24-dind
    container_name: ${config.sessionName}-dind
    hostname: dind
    privileged: true
    environment:
      - DOCKER_TLS_CERTDIR=/certs
    volumes:
${dindVolume}
      - dind-certs:/certs
    networks:
      ${this.networkName}:
        aliases:
          - ${config.sessionName}-dind
    healthcheck:
      test: ["CMD", "docker", "info"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  opencode:
${opencodeBlock}
    container_name: ${config.sessionName}-opencode
    hostname: ${config.sessionName}-opencode
    depends_on:
      dind:
        condition: service_healthy
    environment:
      - DOCKER_HOST=tcp://dind:2376
      - DOCKER_TLS_VERIFY=1
      - DOCKER_CERT_PATH=/certs/client
      - OPENCODE_PORT=5551
      - WORKSPACE_PATH=${containerSessionPath}
    volumes:
${workspaceMount}
      - dind-certs:/certs:ro
      - ${workspacePath}/config/ssh_config:/home/vscode/.ssh/config:ro
      - ${workspacePath}/config/known_hosts:/home/vscode/.ssh/known_hosts:ro
${skillsMount}
    networks:
      ${this.networkName}:
        aliases:
          - ${config.sessionName}-opencode.oc
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5551/doc"]
      interval: 30s
      timeout: 3s
      retries: 3
    restart: unless-stopped

  code-server:
    image: codercom/code-server:latest
    container_name: ${config.sessionName}-code
    hostname: ${config.sessionName}-code
    depends_on:
      dind:
        condition: service_healthy
    environment:
      - DOCKER_HOST=tcp://dind:2376
      - DOCKER_TLS_VERIFY=1
      - DOCKER_CERT_PATH=/certs/client
    volumes:
      - ${config.sessionPath}/code-server:/home/coder/.local/share/code-server
${workspaceMount}
      - dind-certs:/certs:ro
      - ${workspacePath}/config/ssh_config:/home/coder/.ssh/config:ro
      - ${workspacePath}/config/known_hosts:/home/coder/.ssh/known_hosts:ro
${skillsMount}
    command: ${containerSessionPath}/code-server/start.sh
    networks:
      ${this.networkName}:
        aliases:
          - ${config.sessionName}-code.oc
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${config.sessionName}-code.rule=Host(\`${config.sessionName}-code.${config.publicDomain}\`)"
      - "traefik.http.services.${config.sessionName}-code.loadbalancer.server.port=8080"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
    restart: unless-stopped

volumes:
${dindVolumeDefinition}  dind-certs:
    name: ${config.sessionName}-dind-certs

networks:
  ${this.networkName}:
    external: true
`
  }
}
