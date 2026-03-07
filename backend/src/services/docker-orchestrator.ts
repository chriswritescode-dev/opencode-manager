import Docker from 'dockerode'
import { logger } from '../utils/logger'
import { writeFile } from 'fs/promises'
import path from 'path'
import { execCommand } from '../utils/process'

export interface ComposeConfig {
  sessionName: string
  sessionPath: string
  imageId?: string
  nixPackages: string
  configHash: string
  publicDomain: string
}

export interface ContainerInfo {
  id: string
  name: string
  state: 'running' | 'stopped' | 'exited' | 'created'
  health?: 'healthy' | 'unhealthy' | 'starting'
}

export class DockerOrchestrator {
  private docker: Docker
  private networkName = 'opencode-net'

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' })
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

      return {
        id: container.Id,
        name: container.Names[0]?.replace(/^\//, '') || containerName,
        state: container.State as ContainerInfo['state'],
        health: container.Status.includes('healthy') ? 'healthy' 
          : container.Status.includes('unhealthy') ? 'unhealthy'
          : container.Status.includes('health: starting') ? 'starting'
          : undefined,
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

  private async generateComposeFile(config: ComposeConfig): Promise<string> {
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
      - ${config.sessionPath}/docker:/var/lib/docker
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
    build:
      context: /workspace/devcontainers/\${DEVCONTAINER_TEMPLATE:-minimal}
      dockerfile: Dockerfile.nix
      args:
        NIX_PACKAGES: ${config.nixPackages}
        DEVCONTAINER_HASH: ${config.configHash}
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
      - WORKSPACE_PATH=/workspace
    volumes:
      - ${config.sessionPath}:/workspace
      - dind-certs:/certs:ro
      - /workspace/config/ssh_config:/home/vscode/.ssh/config:ro
      - /workspace/config/known_hosts:/home/vscode/.ssh/known_hosts:ro
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
      - ${config.sessionPath}:/workspace
      - ${config.sessionPath}/code-server:/home/coder/.local/share/code-server
      - dind-certs:/certs:ro
      - /workspace/config/ssh_config:/home/coder/.ssh/config:ro
      - /workspace/config/known_hosts:/home/coder/.ssh/known_hosts:ro
      - /workspace/devcontainers:/workspace-root/devcontainers
      - /workspace/repos:/workspace-root/repos:ro
    command: >
      --bind-addr 0.0.0.0:8080
      --auth none
      --disable-telemetry
      /workspace
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
  dind-certs:
    name: ${config.sessionName}-dind-certs

networks:
  ${this.networkName}:
    external: true
`
  }
}
