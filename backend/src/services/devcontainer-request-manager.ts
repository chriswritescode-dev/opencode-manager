import type { Database } from 'bun:sqlite'
import type { DevcontainerChanges, DevcontainerUpdateRequest } from '@opencode-manager/shared'
import { DevcontainerManager } from './devcontainer-manager'
import { SessionManager } from './session-manager'
import * as db from '../db/queries-session'

export class DevcontainerRequestManager {
  private db: Database
  private devcontainerManager: DevcontainerManager
  private sessionManager: SessionManager

  constructor(database: Database, devcontainerManager: DevcontainerManager, sessionManager: SessionManager) {
    this.db = database
    this.devcontainerManager = devcontainerManager
    this.sessionManager = sessionManager
  }

  async createRequest(request: Omit<DevcontainerUpdateRequest, 'status' | 'createdAt'>): Promise<DevcontainerUpdateRequest & { id: number }> {
    const createdAt = Date.now()
    const status: DevcontainerUpdateRequest['status'] = 'pending'
    const id = db.createDevcontainerRequest(this.db, {
      sessionId: request.sessionId,
      templateName: request.templateName || null,
      requestedBy: request.requestedBy,
      changes: JSON.stringify(request.changes),
      reason: request.reason || null,
      action: request.action || null,
      status,
      createdAt,
    })

    return { ...request, id, status, createdAt }
  }

  listRequests(sessionId: string): Array<DevcontainerUpdateRequest & { id: number }> {
    return db.listDevcontainerRequestsBySession(this.db, sessionId).map((row) => this.mapRow(row))
  }

  getRequest(id: number): (DevcontainerUpdateRequest & { id: number }) | null {
    const row = db.getDevcontainerRequestById(this.db, id)
    return row ? this.mapRow(row) : null
  }

  async approveRequest(id: number): Promise<void> {
    db.updateDevcontainerRequestStatus(this.db, id, 'approved')
  }

  async rejectRequest(id: number): Promise<void> {
    db.updateDevcontainerRequestStatus(this.db, id, 'rejected')
  }

  async applyRequest(id: number): Promise<DevcontainerUpdateRequest & { id: number }> {
    const request = this.getRequest(id)
    if (!request) {
      throw new Error(`Request ${id} not found`)
    }

    if (request.status !== 'approved') {
      throw new Error(`Request ${id} is not approved`)
    }

    const session = await this.sessionManager.getSession(request.sessionId)
    if (!session) {
      throw new Error(`Session ${request.sessionId} not found`)
    }

    const baseTemplateName = request.templateName || session.devcontainerTemplate
    const baseTemplate = await this.devcontainerManager.getTemplate(baseTemplateName)
    if (!baseTemplate) {
      throw new Error(`Template ${baseTemplateName} not found`)
    }

    const updatedConfig = this.applyChanges(baseTemplate.config, request.changes)
    const action = request.action || (baseTemplate.isBuiltIn ? 'fork' : 'modify')
    let finalTemplateName = baseTemplateName

    if (action === 'fork') {
      const forkName = this.generateForkName(baseTemplateName, session.name, id)
      await this.devcontainerManager.createTemplate(forkName, updatedConfig, baseTemplateName)
      finalTemplateName = forkName
      db.updateSessionDevcontainerTemplate(this.db, session.id, forkName)
    } else {
      await this.devcontainerManager.updateTemplate(baseTemplateName, updatedConfig)
    }

    const hash = this.devcontainerManager.calculateConfigHash(updatedConfig)
    db.updateSessionDevcontainerConfigHash(this.db, session.id, hash)
    db.updateSessionStatus(this.db, session.id, 'stale')

    db.updateDevcontainerRequestStatus(this.db, id, 'applied')
    return { ...request, status: 'applied' }
  }

  private applyChanges(base: any, changes: DevcontainerChanges) {
    const updated = JSON.parse(JSON.stringify(base))

    const nixPackages = (updated.build?.args?.NIX_PACKAGES || '').split(' ').filter(Boolean)
    const nixSet = new Set(nixPackages)
    for (const pkg of changes.addNixPackages || []) {
      nixSet.add(pkg)
    }
    for (const pkg of changes.removeNixPackages || []) {
      nixSet.delete(pkg)
    }
    updated.build = updated.build || { dockerfile: 'Dockerfile.nix', context: '.', args: { NIX_PACKAGES: '' } }
    updated.build.args = { ...updated.build.args, NIX_PACKAGES: Array.from(nixSet).join(' ') }

    if (changes.addEnv || changes.removeEnv) {
      updated.containerEnv = { ...(updated.containerEnv || {}) }
      for (const [key, value] of Object.entries(changes.addEnv || {})) {
        updated.containerEnv[key] = value
      }
      for (const key of changes.removeEnv || []) {
        delete updated.containerEnv[key]
      }
    }

    if (changes.addMounts) {
      const mounts = new Set([...(updated.mounts || [])])
      for (const mount of changes.addMounts) {
        mounts.add(mount)
      }
      updated.mounts = Array.from(mounts)
    }

    if (changes.customChanges) {
      Object.assign(updated, changes.customChanges)
    }

    return updated
  }

  private generateForkName(templateName: string, sessionName: string, requestId: number): string {
    const raw = `${templateName}-${sessionName}-fork-${requestId}`
    return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 63)
  }

  private mapRow(row: any): DevcontainerUpdateRequest & { id: number } {
    return {
      id: row.id,
      sessionId: row.session_id,
      templateName: row.template_name || undefined,
      requestedBy: row.requested_by,
      changes: JSON.parse(row.changes),
      reason: row.reason || undefined,
      action: row.action || undefined,
      status: row.status,
      createdAt: row.created_at,
    }
  }
}
