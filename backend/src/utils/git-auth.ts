export function isGitHubHttpsUrl(repoUrl: string): boolean {
  try {
    const parsed = new URL(repoUrl)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
  } catch {
    return false
  }
}

export function createNoPromptGitEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: '0'
  }
}

export function createGitHubGitEnv(gitToken: string): Record<string, string> {
  const basicAuth = Buffer.from(`x-access-token:${gitToken}`, 'utf8').toString('base64')

  return {
    ...createNoPromptGitEnv(),
    GITHUB_TOKEN: gitToken,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`
  }
}

export function createGitEnvForRepoUrl(repoUrl: string, gitToken?: string): Record<string, string> {
  if (!gitToken) {
    return createNoPromptGitEnv()
  }

  if (isGitHubHttpsUrl(repoUrl)) {
    return createGitHubGitEnv(gitToken)
  }

  return createNoPromptGitEnv()
}
