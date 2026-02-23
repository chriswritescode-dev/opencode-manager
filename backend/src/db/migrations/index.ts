import type { Migration } from '../migration-runner'
import migration001 from './001-base-schema'
import migration002 from './002-repos-nullable-url'
import migration003 from './003-repos-add-columns'
import migration004 from './004-repos-indexes'
import migration005 from './005-repos-local-path-prefix'
import migration006 from './006-git-token-to-credentials'

export const allMigrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
]
