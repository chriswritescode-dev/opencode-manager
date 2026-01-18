import type { IPCServer } from '../ipc/ipcServer'
import type { Database } from 'bun:sqlite'
import { AskpassHandler } from '../ipc/askpassHandler'

export class GitAuthService {
  private askpassHandler: AskpassHandler | null = null

  initialize(ipcServer: IPCServer | undefined, database: Database): void {
    this.askpassHandler = new AskpassHandler(ipcServer, database)
  }

  getGitEnvironment(silent: boolean = false): Record<string, string> {
    const env: Record<string, string> = {
      GIT_TERMINAL_PROMPT: '0',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    }

    if (silent) {
      env.VSCODE_GIT_FETCH_SILENT = 'true'
    }

    if (this.askpassHandler) {
      Object.assign(env, this.askpassHandler.getEnv())
    }

    return env
  }
}
