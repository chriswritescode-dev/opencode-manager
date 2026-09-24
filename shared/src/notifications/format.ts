const PERMISSION_LABELS: Record<string, string> = {
  read: 'Read File',
  edit: 'Edit File',
  glob: 'Search Files',
  grep: 'Search Content',
  shell: 'Run Command',
  subagent: 'Run Subagent',
  external_directory: 'External Access',
  question: 'Ask Question',
  webfetch: 'Fetch URL',
  websearch: 'Web Search',
  skill: 'Use Skill',
}

export function getPermissionLabel(permission: string): string {
  if (!permission) return 'Approval'
  return PERMISSION_LABELS[permission] ?? permission.charAt(0).toUpperCase() + permission.slice(1)
}

interface PermissionLike {
  action?: unknown
  metadata?: unknown
  resources?: unknown
}

export interface PermissionDetail {
  primary: string
  secondary?: string
}

export function getPermissionDetail(input: PermissionLike): PermissionDetail {
  const action = typeof input.action === 'string' ? input.action : ''
  const metadata = (input.metadata && typeof input.metadata === 'object' ? input.metadata : {}) as Record<string, unknown>
  const resources = Array.isArray(input.resources) ? input.resources.filter((resource): resource is string => typeof resource === 'string') : []
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

  switch (action) {
    case 'edit': {
      const files = Array.isArray(metadata.files) ? metadata.files : []
      const first = (files[0] && typeof files[0] === 'object' ? files[0] : {}) as Record<string, unknown>
      const filePath = str(first.file) ?? str(metadata.filepath)
      if (filePath) {
        const diff = str(first.patch) ?? str(metadata.diff)
        return { primary: filePath, secondary: diff ? diff.slice(0, 500) + (diff.length > 500 ? '\n...' : '') : undefined }
      }
      break
    }
    case 'webfetch': {
      const url = str(metadata.url)
      if (url) return { primary: url }
      break
    }
  }

  return { primary: resources.join('\n') }
}

interface FormLike {
  title?: unknown
}

export function getFormText(form: FormLike | null | undefined): string {
  return form && typeof form.title === 'string' && form.title.length > 0 ? form.title : ''
}
