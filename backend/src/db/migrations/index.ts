import type { Migration } from '../migration-runner'
import migration001 from './001-base-schema'
import migration002 from './002-repos-nullable-url'
import migration003 from './003-repos-add-columns'
import migration004 from './004-repos-indexes'
import migration005 from './005-repos-local-path-prefix'
import migration006 from './006-git-token-to-credentials'
import migration007 from './007-schedules'
import migration008 from './008-schedule-cron-support'
import migration009 from './009-repo-source-path'
import migration010 from './009-prompt-templates'
import migration011 from './011-repo-last-accessed'
import migration012 from './012-opencode-model-state'
import migration013 from './013-app-secrets'
import migration014 from './014-repos-add-name'
import migration015 from './015-schedule-worktree-isolation'
import migration016 from './016-schedule-permission-config'
import migration017 from './017-schedule-run-workspace-id'
import migration018 from './018-session-pins'
import migration019 from './019-drop-opencode-configs'
import migration020 from './020-drop-opencode-model-state'
import migration021 from './021-drop-schedule-run-workspace-id'
import migration022 from './022-schedule-runs-session-index'
import migration023 from './023-schedule-mcp-servers'
import migration024 from './024-schedule-runs-viewed-at'
import migration025 from './025-session-permission-modes'
import migration026 from './026-session-goals'
import migration027 from './027-multi-runs'
import migration202610061345 from './202610061345-schedule-workspace-mode'
import migration202610061700 from './202610061700-multi-run-fusions'
import migration202610061701 from './202610061701-change-walkthroughs'

export const allMigrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration024,
  migration025,
  migration026,
  migration027,
  migration202610061345,
  migration202610061700,
  migration202610061701,
]
