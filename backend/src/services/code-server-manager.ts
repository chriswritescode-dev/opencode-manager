import type { DevcontainerTemplate, Session } from '@opencode-manager/shared'
import { mkdir, writeFile, chmod } from 'fs/promises'
import path from 'path'
import { getContainerWorkspacesPath } from '@opencode-manager/shared/config/env'

export class CodeServerManager {
  async prepareSession(session: Session, template: DevcontainerTemplate): Promise<void> {
    await mkdir(session.codeServerConfigPath, { recursive: true })

    const extensions = template.config.customizations?.vscode?.extensions || []
    const extensionsPath = path.join(session.codeServerConfigPath, 'extensions.txt')
    await writeFile(extensionsPath, extensions.join('\n'), 'utf-8')

    const configPath = path.join(session.codeServerConfigPath, 'config.yaml')
    const config = [
      'bind-addr: 0.0.0.0:8080',
      'auth: none',
      'disable-telemetry: true',
      'disable-update-check: true',
      'user-data-dir: /home/coder/.local/share/code-server',
      'extensions-dir: /home/coder/.local/share/code-server/extensions',
    ].join('\n')
    await writeFile(configPath, config, 'utf-8')

    const startScriptPath = path.join(session.codeServerConfigPath, 'start.sh')
    const containerSessionPath = path.posix.join(getContainerWorkspacesPath(), session.name)
    const startScript = [
      '#!/usr/bin/env bash',
      'set -e',
      `EXTENSIONS_FILE="${containerSessionPath}/code-server/extensions.txt"`,
      'if [ -f "$EXTENSIONS_FILE" ]; then',
      '  while IFS= read -r ext; do',
      '    if [ -n "$ext" ]; then',
      '      code-server --install-extension "$ext" || true',
      '    fi',
      '  done < "$EXTENSIONS_FILE"',
      'fi',
      `exec code-server --config ${containerSessionPath}/code-server/config.yaml ${containerSessionPath}`,
    ].join('\n')
    await writeFile(startScriptPath, startScript, 'utf-8')
    await chmod(startScriptPath, 0o755)
  }
}
