export interface GitIdentityValues {
  name?: string | null
  email?: string | null
}

/**
 * Formats a git identity as `Name <email>`, using explicit placeholders when a
 * part is missing and a single fallback when nothing is configured.
 */
export function formatGitIdentity(identity: GitIdentityValues): string {
  const name = identity.name
  const email = identity.email
  if (!name && !email) return 'Not configured'
  return `${name || 'No name'} <${email || 'No email'}>`
}
