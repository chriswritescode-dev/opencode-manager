export interface GitIdentityValues {
  name?: string | null
  email?: string | null
}

export function formatGitIdentity(identity: GitIdentityValues): string {
  const name = identity.name
  const email = identity.email
  if (!name && !email) return 'Not configured'
  return `${name || 'No name'} <${email || 'No email'}>`
}
